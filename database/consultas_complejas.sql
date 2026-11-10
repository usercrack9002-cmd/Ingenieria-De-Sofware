-- ============================================================================
-- SCRIPT DE CONSULTAS, VISTAS Y DISPARADOR (TRIGGER)
-- Base de datos: invventas_licor
-- Autor: Asistente Antigravity
-- ============================================================================

USE invventas_licor;

-- ============================================================================
-- PARTE 1: CREACIÓN DE VISTAS ANALÍTICAS (2 Vistas)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Vista 1: v_rentabilidad_productos
-- Calcula las ventas totales, el costo promedio estimado (basado en el lote vendido), 
-- la utilidad bruta y el margen de ganancia porcentual estimado por producto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rentabilidad_productos AS
SELECT 
    p.id_producto,
    p.nombre AS producto,
    c.nombre AS categoria,
    p.precio_venta AS precio_venta_actual,
    COALESCE(SUM(vd.cantidad), 0) AS unidades_vendidas,
    COALESCE(SUM(vd.total), 0) AS ingresos_totales,
    ROUND(COALESCE(SUM(vd.cantidad * inv.precio_costo), 0), 2) AS costo_total_estimado,
    ROUND(COALESCE(SUM(vd.total), 0) - COALESCE(SUM(vd.cantidad * inv.precio_costo), 0), 2) AS utilidad_estimada,
    ROUND(
        IF(COALESCE(SUM(vd.total), 0) > 0, 
           ((COALESCE(SUM(vd.total), 0) - COALESCE(SUM(vd.cantidad * inv.precio_costo), 0)) / COALESCE(SUM(vd.total), 0)) * 100, 
           0), 
        2
    ) AS margen_porcentual_estimado
FROM productos p
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
LEFT JOIN venta_detalle vd ON p.id_producto = vd.id_producto AND vd.estado = 'Vendido'
LEFT JOIN inventario inv ON vd.id_inventario = inv.id_inventario
GROUP BY p.id_producto, p.nombre, c.nombre, p.precio_venta;


-- ----------------------------------------------------------------------------
-- Vista 2: v_desempeno_vendedores
-- Evalúa el rendimiento de los vendedores a través del conteo de transacciones,
-- volumen total de ventas, valor promedio del ticket y control de anulaciones.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_desempeno_vendedores AS
SELECT 
    u.id_usuario,
    u.nombre_completo AS vendedor,
    s.nombre AS sucursal,
    COUNT(DISTINCT v.id_venta) AS total_ventas_intentadas,
    COALESCE(SUM(CASE WHEN v.estado = 'Completada' THEN v.total ELSE 0 END), 0) AS ingresos_generados,
    ROUND(COALESCE(AVG(CASE WHEN v.estado = 'Completada' THEN v.total ELSE NULL END), 0), 2) AS ticket_promedio,
    COUNT(DISTINCT CASE WHEN v.estado = 'Anulada' THEN v.id_venta ELSE NULL END) AS ventas_anuladas,
    COALESCE(SUM(CASE WHEN v.estado = 'Anulada' THEN v.total ELSE 0 END), 0) AS monto_anulado,
    ROUND(
        (COUNT(DISTINCT CASE WHEN v.estado = 'Anulada' THEN v.id_venta ELSE NULL END) / 
         NULLIF(COUNT(DISTINCT v.id_venta), 0)) * 100, 
        2
    ) AS porcentaje_anulaciones
FROM usuarios u
INNER JOIN roles r ON u.id_rol = r.id_rol
LEFT JOIN sucursales s ON u.id_sucursal = s.id_sucursal
LEFT JOIN ventas v ON u.id_usuario = v.id_usuario
WHERE r.nombre = 'Vendedor'
GROUP BY u.id_usuario, u.nombre_completo, s.nombre;


-- ============================================================================
-- PARTE 2: CREACIÓN DE DISPARADOR (1 Trigger)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Trigger: trg_venta_detalle_restar_stock
-- Se ejecuta ANTES de insertar un registro en 'venta_detalle'.
-- Realiza una validación de stock y luego resta la cantidad vendida directamente
-- del lote ('inventario') correspondiente. Si no hay suficiente stock, lanza un error.
-- ----------------------------------------------------------------------------
DELIMITER //

DROP TRIGGER IF EXISTS trg_venta_detalle_restar_stock//

CREATE TRIGGER trg_venta_detalle_restar_stock
BEFORE INSERT ON venta_detalle
FOR EACH ROW
BEGIN
    DECLARE v_stock_actual INT;
    
    -- Obtener el stock actual en unidades para el lote de inventario especificado
    SELECT stock INTO v_stock_actual
    FROM inventario
    WHERE id_inventario = NEW.id_inventario;
    
    -- Validación 1: El lote de inventario debe existir
    IF v_stock_actual IS NULL THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Error: El lote de inventario especificado no existe o no tiene stock registrado.';
    -- Validación 2: Suficiente stock para suplir la venta
    ELSEIF v_stock_actual < NEW.cantidad THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Error: Stock insuficiente en el lote seleccionado para realizar la venta.';
    ELSE
        -- Modificación de inventario: Reducir el stock del lote
        UPDATE inventario
        SET stock = stock - NEW.cantidad
        WHERE id_inventario = NEW.id_inventario;
    END IF;
END//

DELIMITER ;


-- ============================================================================
-- PARTE 3: 15 CONSULTAS COMPLEJAS DE NEGOCIO (BI y Auditoría)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Consulta 1: Ranking de los productos más vendidos por sucursal
-- Propósito: Identificar los productos más demandados en cada punto físico usando CTEs y funciones de ventana.
-- Técnico: Emplea DENSE_RANK() para ordenar las ventas de productos particionado por sucursal.
-- ----------------------------------------------------------------------------
WITH VentasPorSucursal AS (
    SELECT 
        v.id_sucursal,
        s.nombre AS sucursal,
        p.id_producto,
        p.nombre AS producto,
        SUM(vd.cantidad) AS total_unidades_vendidas,
        SUM(vd.total) AS total_monto_vendido
    FROM venta_detalle vd
    INNER JOIN ventas v ON vd.id_venta = v.id_venta
    INNER JOIN productos p ON vd.id_producto = p.id_producto
    INNER JOIN sucursales s ON v.id_sucursal = s.id_sucursal
    WHERE v.estado = 'Completada' AND vd.estado = 'Vendido'
    GROUP BY v.id_sucursal, s.nombre, p.id_producto, p.nombre
),
RankingProductos AS (
    SELECT 
        id_sucursal,
        sucursal,
        id_producto,
        producto,
        total_unidades_vendidas,
        total_monto_vendido,
        DENSE_RANK() OVER (PARTITION BY id_sucursal ORDER BY total_unidades_vendidas DESC) AS posicion_venta
    FROM VentasPorSucursal
)
SELECT 
    sucursal,
    posicion_venta,
    producto,
    total_unidades_vendidas,
    total_monto_vendido
FROM RankingProductos
ORDER BY sucursal, posicion_venta;


-- ----------------------------------------------------------------------------
-- Consulta 2: Productos cuyas ventas totales superan el promedio de su respectiva categoría
-- Propósito: Detectar qué artículos tienen un rendimiento excepcionalmente alto comparado con su propio grupo.
-- Técnico: Uso de CTEs y un INNER JOIN sobre subconsultas agregadas.
-- ----------------------------------------------------------------------------
WITH VentasProducto AS (
    SELECT 
        p.id_producto,
        p.nombre AS producto,
        p.id_categoria,
        c.nombre AS categoria,
        COALESCE(SUM(vd.total), 0) AS total_vendido
    FROM productos p
    INNER JOIN categorias c ON p.id_categoria = c.id_categoria
    LEFT JOIN venta_detalle vd ON p.id_producto = vd.id_producto AND vd.estado = 'Vendido'
    LEFT JOIN ventas v ON vd.id_venta = v.id_venta AND v.estado = 'Completada'
    GROUP BY p.id_producto, p.nombre, p.id_categoria, c.nombre
),
PromedioVentasCategoria AS (
    SELECT 
        id_categoria,
        AVG(total_vendido) AS promedio_categoria
    FROM VentasProducto
    GROUP BY id_categoria
)
SELECT 
    vp.producto,
    vp.categoria,
    vp.total_vendido,
    ROUND(pvc.promedio_categoria, 2) AS promedio_categoria,
    ROUND(vp.total_vendido - pvc.promedio_categoria, 2) AS diferencia_sobre_promedio
FROM VentasProducto vp
INNER JOIN PromedioVentasCategoria pvc ON vp.id_categoria = pvc.id_categoria
WHERE vp.total_vendido > pvc.promedio_categoria
ORDER BY vp.categoria, diferencia_sobre_promedio DESC;


-- ----------------------------------------------------------------------------
-- Consulta 3: Análisis de margen de ganancia real vs. esperado por producto vendido
-- Propósito: Comparar el costo de adquisición de los lotes de inventario contra el precio final cobrado.
-- Técnico: Unión de venta_detalle con inventario para rastrear el 'precio_costo' exacto del lote vendido.
-- ----------------------------------------------------------------------------
SELECT 
    p.nombre AS producto,
    c.nombre AS categoria,
    SUM(vd.cantidad) AS unidades_vendidas,
    ROUND(AVG(vd.precio_unitario), 2) AS precio_venta_promedio,
    ROUND(AVG(i.precio_costo), 2) AS costo_unitario_promedio,
    SUM(vd.total) AS ingresos_totales,
    ROUND(SUM(vd.cantidad * i.precio_costo), 2) AS costo_total_adquisicion,
    ROUND(SUM(vd.total) - SUM(vd.cantidad * i.precio_costo), 2) AS utilidad_real,
    ROUND(((SUM(vd.total) - SUM(vd.cantidad * i.precio_costo)) / NULLIF(SUM(vd.total), 0)) * 100, 2) AS margen_real_porcentaje
FROM venta_detalle vd
INNER JOIN ventas v ON vd.id_venta = v.id_venta
INNER JOIN productos p ON vd.id_producto = p.id_producto
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
INNER JOIN inventario i ON vd.id_inventario = i.id_inventario
WHERE v.estado = 'Completada' AND vd.estado = 'Vendido'
GROUP BY p.id_producto, p.nombre, c.nombre
HAVING ingresos_totales > 0
ORDER BY utilidad_real DESC;


-- ----------------------------------------------------------------------------
-- Consulta 4: Ventas acumuladas (Running Total) de forma mensual por sucursal
-- Propósito: Obtener un reporte histórico del crecimiento acumulado mes a mes en cada punto de venta.
-- Técnico: Uso de la función de ventana SUM() OVER con orden temporal.
-- ----------------------------------------------------------------------------
WITH VentasMensuales AS (
    SELECT 
        s.nombre AS sucursal,
        DATE_FORMAT(v.fecha, '%Y-%m') AS mes,
        SUM(v.total) AS total_mes
    FROM ventas v
    INNER JOIN sucursales s ON v.id_sucursal = s.id_sucursal
    WHERE v.estado = 'Completada'
    GROUP BY s.nombre, DATE_FORMAT(v.fecha, '%Y-%m')
)
SELECT 
    sucursal,
    mes,
    total_mes,
    ROUND(SUM(total_mes) OVER (PARTITION BY sucursal ORDER BY mes), 2) AS ventas_acumuladas_historicas
FROM VentasMensuales
ORDER BY sucursal, mes;


-- ----------------------------------------------------------------------------
-- Consulta 5: Detección de arqueos con descuadre y trazabilidad de eventos operativos
-- Propósito: Identificar descuadres de caja y vincularlos con el volumen de transacciones de ese día.
-- Técnico: Filtro por diferencia != 0 y subconsulta correlacionada para auditar registros de log.
-- ----------------------------------------------------------------------------
SELECT 
    ac.id_arqueo,
    ac.fecha,
    s.nombre AS sucursal,
    u.nombre_completo AS cajero,
    ac.efectivo_inicial,
    ac.ventas_efectivo,
    ac.gastos_aprobados,
    ac.efectivo_esperado,
    ac.efectivo_contado,
    ac.diferencia,
    ac.estado AS estado_arqueo,
    ac.observaciones,
    (
        SELECT COUNT(*) 
        FROM log_operaciones lo 
        WHERE lo.id_usuario = ac.id_usuario 
          AND lo.id_sucursal = ac.id_sucursal
          AND DATE(lo.fecha) = ac.fecha
    ) AS cantidad_operaciones_en_log
FROM arqueos_caja ac
INNER JOIN sucursales s ON ac.id_sucursal = s.id_sucursal
INNER JOIN usuarios u ON ac.id_usuario = u.id_usuario
WHERE ac.diferencia <> 0.00
ORDER BY ABS(ac.diferencia) DESC;


-- ----------------------------------------------------------------------------
-- Consulta 6: Valorización del inventario y presupuesto necesario para reabastecimiento
-- Propósito: Calcular el valor del inventario a precio costo/venta y estimar el costo de reabastecer a nivel óptimo.
-- Técnico: Uso de estructuras CASE condicionales para determinar niveles óptimos y costo de reposición.
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    c.nombre AS categoria,
    p.nombre AS producto,
    i.stock AS stock_actual,
    i.stock_minimo,
    ROUND(i.precio_costo, 2) AS costo_unitario,
    ROUND(i.stock * i.precio_costo, 2) AS valor_inventario_costo,
    ROUND(i.stock * p.precio_venta, 2) AS valor_inventario_venta,
    CASE 
        WHEN i.stock <= i.stock_minimo THEN '⚠️ CRÍTICO: Reposición Inmediata'
        WHEN i.stock <= (i.stock_minimo * 1.5) THEN '💡 PRECAUCIÓN: Stock Moderado'
        ELSE '✅ Seguro'
    END AS estado_alerta,
    -- Nivel óptimo definido como stock_minimo * 3
    CASE 
        WHEN i.stock < (i.stock_minimo * 3) THEN (i.stock_minimo * 3) - i.stock
        ELSE 0
    END AS unidades_a_pedir,
    ROUND(
        CASE 
            WHEN i.stock < (i.stock_minimo * 3) THEN ((i.stock_minimo * 3) - i.stock) * i.precio_costo
            ELSE 0
        END, 2
    ) AS presupuesto_reposicion_estimado
FROM inventario i
INNER JOIN productos p ON i.id_producto = p.id_producto
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
INNER JOIN sucursales s ON i.id_sucursal = s.id_sucursal
WHERE p.id_estado = 1
ORDER BY estado_alerta DESC, presupuesto_reposicion_estimado DESC;


-- ----------------------------------------------------------------------------
-- Consulta 7: Análisis comparativo de precios: Venta actual vs. Sugerido en última compra
-- Propósito: Comparar el precio de venta configurado con el sugerido por la última factura recibida.
-- Técnico: Uso de ROW_NUMBER() para aislar la última compra y cálculo de desviaciones.
-- ----------------------------------------------------------------------------
WITH UltimaCompraProducto AS (
    SELECT 
        cd.id_producto,
        cd.precio_unitario_neto,
        cd.precio_venta_sugerido,
        cd.margen_ganancia,
        co.fecha AS fecha_compra,
        ROW_NUMBER() OVER (PARTITION BY cd.id_producto ORDER BY co.fecha DESC, cd.id_compra_detalle DESC) as rn
    FROM compra_detalle cd
    INNER JOIN compras co ON cd.id_compra = co.id_compra
    WHERE co.estado = 'Activa'
)
SELECT 
    p.nombre AS producto,
    cat.nombre AS categoria,
    p.precio_venta AS precio_venta_actual,
    ROUND(uc.precio_unitario_neto, 2) AS ultimo_costo_neto,
    ROUND(uc.precio_venta_sugerido, 2) AS precio_venta_sugerido_compras,
    uc.margen_ganancia AS margen_esperado_porcentaje,
    ROUND(p.precio_venta - uc.precio_venta_sugerido, 2) AS diferencia_precio,
    ROUND(((p.precio_venta - uc.precio_venta_sugerido) / NULLIF(uc.precio_venta_sugerido, 0)) * 100, 2) AS desviacion_porcentaje,
    CASE 
        WHEN p.precio_venta < uc.precio_venta_sugerido THEN '🚨 Aumentar precio (Margen bajo)'
        WHEN p.precio_venta > (uc.precio_venta_sugerido * 1.2) THEN '🏷️ Evaluar descuento (Precio elevado)'
        ELSE '✅ Alineado con margen objetivo'
    END AS accion_sugerida
FROM productos p
INNER JOIN categorias cat ON p.id_categoria = cat.id_categoria
INNER JOIN UltimaCompraProducto uc ON p.id_producto = uc.id_producto
WHERE uc.rn = 1
ORDER BY desviacion_porcentaje ASC;


-- ----------------------------------------------------------------------------
-- Consulta 8: Análisis de impacto de movimientos entre sucursales
-- Propósito: Auditar las transferencias de mercancía analizando el volumen movido vs el stock de origen.
-- Técnico: Uso de subconsultas correlacionadas para medir el impacto relativo de transferencia.
-- ----------------------------------------------------------------------------
SELECT 
    mi.id_movimiento,
    mi.fecha,
    p.nombre AS producto,
    so.nombre AS sucursal_origen,
    sd.nombre AS sucursal_destino,
    a.nombre AS empaque_usado,
    mi.cantidad_agrupacion,
    mi.cantidad_unidades AS unidades_transferidas,
    u.nombre_completo AS responsable,
    mi.observaciones,
    ROUND(
        (mi.cantidad_unidades / 
         (SELECT COALESCE(SUM(inv.stock), 1) 
          FROM inventario inv 
          WHERE inv.id_producto = mi.id_producto AND inv.id_sucursal = mi.id_sucursal_origen)
        ) * 100, 
        2
    ) AS pct_impacto_inventario_origen
FROM movimientos_inventario mi
INNER JOIN productos p ON mi.id_producto = p.id_producto
INNER JOIN sucursales so ON mi.id_sucursal_origen = so.id_sucursal
INNER JOIN sucursales sd ON mi.id_sucursal_destino = sd.id_sucursal
INNER JOIN usuarios u ON mi.id_usuario = u.id_usuario
LEFT JOIN agrupaciones a ON mi.id_agrupacion = a.id_agrupacion
ORDER BY mi.fecha DESC;


-- ----------------------------------------------------------------------------
-- Consulta 9: Evaluación de Proveedores (Tiempos de entrega, Ahorros y Bonificaciones)
-- Propósito: Evaluar qué proveedores ofrecen mejores condiciones comerciales e índices de cumplimiento.
-- Técnico: Cálculo de diferencias de fecha con DATEDIFF() y acumulaciones de descuentos/bonificaciones.
-- ----------------------------------------------------------------------------
SELECT 
    pr.id_proveedor,
    pr.nombre AS proveedor,
    COUNT(DISTINCT c.id_compra) AS total_compras,
    ROUND(SUM(c.total), 2) AS facturado_total,
    ROUND(SUM(cd.descuento), 2) AS descuentos_obtenidos,
    SUM(cd.bonificacion) AS unidades_bonificadas_gratis,
    ROUND(AVG(DATEDIFF(cd.fecha_entrega, c.fecha)), 1) AS dias_promedio_entrega,
    ROUND((SUM(cd.descuento) / NULLIF(SUM(c.subtotal), 0)) * 100, 2) AS pct_descuento_promedio
FROM proveedores pr
INNER JOIN compras c ON pr.id_proveedor = c.id_proveedor
INNER JOIN compra_detalle cd ON c.id_compra = cd.id_compra
WHERE c.estado = 'Activa'
GROUP BY pr.id_proveedor, pr.nombre
ORDER BY facturado_total DESC;


-- ----------------------------------------------------------------------------
-- Consulta 10: Análisis de días de la semana y horas de pico de ventas
-- Propósito: Planificar los horarios de personal y promociones basados en la afluencia y compras.
-- Técnico: Extracción de partes de fecha y agregaciones avanzadas.
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    CASE DAYOFWEEK(v.fecha)
        WHEN 1 THEN 'Domingo'
        WHEN 2 THEN 'Lunes'
        WHEN 3 THEN 'Martes'
        WHEN 4 THEN 'Miércoles'
        WHEN 5 THEN 'Jueves'
        WHEN 6 THEN 'Viernes'
        WHEN 7 THEN 'Sábado'
    END AS dia_semana,
    CONCAT(HOUR(v.fecha), ':00 - ', HOUR(v.fecha) + 1, ':00') AS franja_horaria,
    COUNT(v.id_venta) AS transacciones,
    ROUND(SUM(v.total), 2) AS ingresos_totales,
    ROUND(AVG(v.total), 2) AS ticket_promedio
FROM ventas v
INNER JOIN sucursales s ON v.id_sucursal = s.id_sucursal
WHERE v.estado = 'Completada'
GROUP BY s.nombre, DAYOFWEEK(v.fecha), HOUR(v.fecha)
ORDER BY sucursal, SUM(v.total) DESC;


-- ----------------------------------------------------------------------------
-- Consulta 11: Auditoría de cancelaciones y tasas de pérdida financiera por vendedor
-- Propósito: Controlar el fraude interno y las fallas de servicio midiendo las anulaciones por vendedor.
-- Técnico: Uso de CTEs y división segura (NULLIF) para evitar errores aritméticos.
-- ----------------------------------------------------------------------------
WITH ResumenPorCajero AS (
    SELECT 
        u.id_usuario,
        u.nombre_completo AS cajero,
        COUNT(v.id_venta) AS total_intentos,
        SUM(CASE WHEN v.estado = 'Completada' THEN 1 ELSE 0 END) AS ventas_completadas,
        SUM(CASE WHEN v.estado = 'Anulada' THEN 1 ELSE 0 END) AS ventas_anuladas,
        SUM(v.total) AS monto_total_procesado,
        SUM(CASE WHEN v.estado = 'Anulada' THEN v.total ELSE 0 END) AS monto_anulado
    FROM usuarios u
    INNER JOIN ventas v ON u.id_usuario = v.id_usuario
    GROUP BY u.id_usuario, u.nombre_completo
)
SELECT 
    r.cajero,
    r.total_intentos,
    r.ventas_completadas,
    r.ventas_anuladas,
    ROUND((r.ventas_anuladas / NULLIF(r.total_intentos, 0)) * 100, 2) AS tasa_anulacion_porcentaje,
    ROUND(r.monto_total_procesado, 2) AS monto_bruto,
    ROUND(r.monto_anulado, 2) AS perdida_por_anulacion,
    ROUND((r.monto_anulado / NULLIF(r.monto_total_procesado, 0)) * 100, 2) AS pct_perdida_financiera
FROM ResumenPorCajero r
WHERE r.total_intentos > 0
ORDER BY tasa_anulacion_porcentaje DESC;


-- ----------------------------------------------------------------------------
-- Consulta 12: Productos sin rotación ("Huesos") en los últimos 30 días o más
-- Propósito: Desalojar capital estancado identificando mercancía que no ha registrado ventas.
-- Técnico: Filtrado con subconsultas de exclusión y cálculo de desfase temporal con DATEDIFF.
-- ----------------------------------------------------------------------------
SELECT 
    p.id_producto,
    p.nombre AS producto,
    c.nombre AS categoria,
    s.nombre AS sucursal,
    inv.stock AS stock_actual,
    inv.precio_costo AS costo_unitario,
    ROUND(inv.stock * inv.precio_costo, 2) AS capital_estancado,
    (
        SELECT MAX(v.fecha) 
        FROM venta_detalle vd
        INNER JOIN ventas v ON vd.id_venta = v.id_venta
        WHERE vd.id_producto = p.id_producto 
          AND v.id_sucursal = s.id_sucursal
          AND v.estado = 'Completada'
          AND vd.estado = 'Vendido'
    ) AS fecha_ultima_venta,
    DATEDIFF(CURDATE(), (
        SELECT MAX(v.fecha) 
        FROM venta_detalle vd
        INNER JOIN ventas v ON vd.id_venta = v.id_venta
        WHERE vd.id_producto = p.id_producto 
          AND v.id_sucursal = s.id_sucursal
          AND v.estado = 'Completada'
          AND vd.estado = 'Vendido'
    )) AS dias_sin_venta
FROM inventario inv
INNER JOIN productos p ON inv.id_producto = p.id_producto
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
INNER JOIN sucursales s ON inv.id_sucursal = s.id_sucursal
WHERE p.id_estado = 1
  AND (
      (SELECT MAX(v.fecha) 
       FROM venta_detalle vd
       INNER JOIN ventas v ON vd.id_venta = v.id_venta
       WHERE vd.id_producto = p.id_producto 
         AND v.id_sucursal = s.id_sucursal
         AND v.estado = 'Completada'
         AND vd.estado = 'Vendido') IS NULL
      OR 
      DATEDIFF(CURDATE(), (
       SELECT MAX(v.fecha) 
       FROM venta_detalle vd
       INNER JOIN ventas v ON vd.id_venta = v.id_venta
       WHERE vd.id_producto = p.id_producto 
         AND v.id_sucursal = s.id_sucursal
         AND v.estado = 'Completada'
         AND vd.estado = 'Vendido'
      )) >= 30
  )
ORDER BY capital_estancado DESC;


-- ----------------------------------------------------------------------------
-- Consulta 13: Crecimiento de Ventas Mes a Mes (Month-over-Month Growth)
-- Propósito: Medir la tasa de crecimiento del negocio y las tendencias de ingresos mensuales.
-- Técnico: Uso de la función de ventana LAG() para referenciar filas anteriores.
-- ----------------------------------------------------------------------------
WITH VentasMensuales AS (
    SELECT 
        DATE_FORMAT(fecha, '%Y-%m') AS mes,
        SUM(total) AS total_ventas
    FROM ventas
    WHERE estado = 'Completada'
    GROUP BY DATE_FORMAT(fecha, '%Y-%m')
),
ComparacionMesAnterior AS (
    SELECT 
        mes,
        total_ventas,
        LAG(total_ventas, 1) OVER (ORDER BY mes) AS ventas_mes_anterior
    FROM VentasMensuales
)
SELECT 
    mes,
    ROUND(total_ventas, 2) AS ventas_mes_actual,
    ROUND(ventas_mes_anterior, 2) AS ventas_mes_anterior,
    ROUND(total_ventas - ventas_mes_anterior, 2) AS crecimiento_absoluto,
    ROUND(
        ((total_ventas - ventas_mes_anterior) / NULLIF(ventas_mes_anterior, 0)) * 100, 
        2
    ) AS crecimiento_porcentual
FROM ComparacionMesAnterior
ORDER BY mes;


-- ----------------------------------------------------------------------------
-- Consulta 14: Pérdida financiera proyectada por vencimiento de lotes en inventario
-- Propósito: Calcular el costo monetario en riesgo por productos caducados o próximos a caducar (90 días).
-- Técnico: Filtrado selectivo de fechas mediante DATE_ADD e intervalos temporales.
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    p.nombre AS producto,
    i.lote,
    i.fecha_vencimiento,
    i.stock AS stock_actual,
    ROUND(i.precio_costo, 2) AS costo_unitario,
    ROUND(i.stock * i.precio_costo, 2) AS perdida_monetaria_proyectada,
    CASE 
        WHEN i.fecha_vencimiento < CURDATE() THEN '🔴 VENCIDO (Pérdida Total)'
        WHEN i.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 15 DAY) THEN '🟠 CRÍTICO (Menos de 15 días)'
        WHEN i.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN '🟡 ALERTA (Menos de 2 meses)'
        ELSE '🟢 Seguro'
    END AS estado_vencimiento,
    DATEDIFF(i.fecha_vencimiento, CURDATE()) AS dias_para_vencer
FROM inventario i
INNER JOIN productos p ON i.id_producto = p.id_producto
INNER JOIN sucursales s ON i.id_sucursal = s.id_sucursal
WHERE i.fecha_vencimiento IS NOT NULL 
  AND i.stock > 0
  AND i.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
ORDER BY i.fecha_vencimiento ASC;


-- ----------------------------------------------------------------------------
-- Consulta 15: Conciliación financiera diaria consolidada de caja
-- Propósito: Comparar el flujo de efectivo esperado contra lo reportado y el total facturado del día.
-- Técnico: Desglose por sucursal y fecha con subconsultas de agregación sobre otros métodos de pago.
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    ac.fecha,
    ac.efectivo_inicial,
    ROUND(COALESCE((
        SELECT SUM(v.total) 
        FROM ventas v 
        WHERE v.id_sucursal = ac.id_sucursal 
          AND DATE(v.fecha) = ac.fecha 
          AND v.estado = 'Completada'
    ), 0), 2) AS ventas_totales_del_dia,
    ROUND(COALESCE((
        SELECT SUM(v.total) 
        FROM ventas v 
        WHERE v.id_sucursal = ac.id_sucursal 
          AND DATE(v.fecha) = ac.fecha 
          AND v.estado = 'Completada' 
          AND v.metodo_pago = 'Efectivo'
    ), 0), 2) AS ventas_efectivo_sistema,
    ac.gastos_aprobados AS salidas_gastos,
    ac.efectivo_esperado,
    ac.efectivo_contado,
    ac.diferencia,
    ac.estado AS estado_arqueo,
    ROUND((ac.gastos_aprobados / NULLIF(ac.ventas_efectivo, 0)) * 100, 2) AS porcentaje_gastos_caja
FROM arqueos_caja ac
INNER JOIN sucursales s ON ac.id_sucursal = s.id_sucursal
ORDER BY ac.fecha DESC, s.nombre;
