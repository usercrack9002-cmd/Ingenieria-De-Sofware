-- ============================================================================
-- SCRIPT DE CONSULTAS, VISTAS Y DISPARADORES (15 CONSULTAS SIMPLIFICADAS)
-- Base de datos: invventas_licor
-- ============================================================================

USE invventas_licor;

-- ============================================================================
-- VISTAS ANALÍTICAS PREVIAS
-- ============================================================================

-- Vista 1: Rentabilidad de Productos
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


-- Vista 2: Desempeño de Vendedores
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
-- DISPARADOR (TRIGGER) DE CONTROL DE STOCK
-- ============================================================================
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
-- LAS 15 CONSULTAS SIMPLIFICADAS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Consulta 1: Ventas totales de productos por sucursal ordenadas de mayor a menor
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    p.nombre AS producto,
    SUM(vd.cantidad) AS total_unidades_vendidas,
    SUM(vd.total) AS total_monto_vendido
FROM venta_detalle vd
INNER JOIN ventas v ON vd.id_venta = v.id_venta
INNER JOIN productos p ON vd.id_producto = p.id_producto
INNER JOIN sucursales s ON v.id_sucursal = s.id_sucursal
WHERE v.estado = 'Completada' AND vd.estado = 'Vendido'
GROUP BY s.nombre, p.nombre
ORDER BY s.nombre, total_unidades_vendidas DESC;


-- ----------------------------------------------------------------------------
-- Consulta 2: Productos cuyas ventas totales superan el promedio de su categoría
-- ----------------------------------------------------------------------------
SELECT 
    p.nombre AS producto,
    c.nombre AS categoria,
    SUM(vd.total) AS total_vendido
FROM productos p
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
INNER JOIN venta_detalle vd ON p.id_producto = vd.id_producto
INNER JOIN ventas v ON vd.id_venta = v.id_venta
WHERE v.estado = 'Completada' AND vd.estado = 'Vendido'
GROUP BY p.nombre, c.nombre
HAVING SUM(vd.total) > (
    SELECT AVG(sub_total)
    FROM (
        SELECT SUM(vd2.total) AS sub_total
        FROM productos p2
        INNER JOIN venta_detalle vd2 ON p2.id_producto = vd2.id_producto
        INNER JOIN ventas v2 ON vd2.id_venta = v2.id_venta
        WHERE v2.estado = 'Completada' AND vd2.estado = 'Vendido' AND p2.id_categoria = p.id_categoria
        GROUP BY p2.id_producto
    ) sub
)
ORDER BY c.nombre, total_vendido DESC;


-- ----------------------------------------------------------------------------
-- Consulta 3: Utilidad real y margen por producto vendido (Ordenado por mayor ganancia)
-- ----------------------------------------------------------------------------
SELECT 
    p.nombre AS producto,
    c.nombre AS categoria,
    SUM(vd.cantidad) AS unidades_vendidas,
    AVG(vd.precio_unitario) AS precio_venta_promedio,
    AVG(i.precio_costo) AS costo_unitario_promedio,
    SUM(vd.total) AS ingresos_totales,
    SUM(vd.cantidad * i.precio_costo) AS costo_total_adquisicion,
    (SUM(vd.total) - SUM(vd.cantidad * i.precio_costo)) AS utilidad_real
FROM venta_detalle vd
INNER JOIN ventas v ON vd.id_venta = v.id_venta
INNER JOIN productos p ON vd.id_producto = p.id_producto
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
INNER JOIN inventario i ON vd.id_inventario = i.id_inventario
WHERE v.estado = 'Completada' AND vd.estado = 'Vendido'
GROUP BY p.nombre, c.nombre
ORDER BY utilidad_real DESC;


-- ----------------------------------------------------------------------------
-- Consulta 4: Ventas totales de forma mensual por sucursal
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    DATE_FORMAT(v.fecha, '%Y-%m') AS mes,
    SUM(v.total) AS total_mes
FROM ventas v
INNER JOIN sucursales s ON v.id_sucursal = s.id_sucursal
WHERE v.estado = 'Completada'
GROUP BY s.nombre, DATE_FORMAT(v.fecha, '%Y-%m')
ORDER BY s.nombre, mes;


-- ----------------------------------------------------------------------------
-- Consulta 5: Detección de arqueos con descuadre
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
    ac.observaciones
FROM arqueos_caja ac
INNER JOIN sucursales s ON ac.id_sucursal = s.id_sucursal
INNER JOIN usuarios u ON ac.id_usuario = u.id_usuario
WHERE ac.diferencia <> 0.00
ORDER BY ABS(ac.diferencia) DESC;


-- ----------------------------------------------------------------------------
-- Consulta 6: Valorización del inventario a precio costo y precio venta
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    c.nombre AS categoria,
    p.nombre AS producto,
    i.stock AS stock_actual,
    i.stock_minimo,
    i.precio_costo AS costo_unitario,
    (i.stock * i.precio_costo) AS valor_inventario_costo,
    (i.stock * p.precio_venta) AS valor_inventario_venta,
    IF(i.stock <= i.stock_minimo, '⚠️ Alerta: Stock Bajo', '✅ Stock Seguro') AS estado_alerta
FROM inventario i
INNER JOIN productos p ON i.id_producto = p.id_producto
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
INNER JOIN sucursales s ON i.id_sucursal = s.id_sucursal
WHERE p.id_estado = 1
ORDER BY i.stock ASC;


-- ----------------------------------------------------------------------------
-- Consulta 7: Comparativa de precios de venta vs sugerido por compras
-- ----------------------------------------------------------------------------
SELECT 
    p.nombre AS producto,
    c.nombre AS categoria,
    p.precio_venta AS precio_venta_actual,
    AVG(cd.precio_unitario_neto) AS costo_promedio,
    AVG(cd.precio_venta_sugerido) AS precio_sugerido_promedio,
    (p.precio_venta - AVG(cd.precio_venta_sugerido)) AS diferencia
FROM productos p
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
INNER JOIN compra_detalle cd ON p.id_producto = cd.id_producto
INNER JOIN compras co ON cd.id_compra = co.id_compra
WHERE co.estado = 'Activa'
GROUP BY p.nombre, c.nombre, p.precio_venta
ORDER BY diferencia ASC;


-- ----------------------------------------------------------------------------
-- Consulta 8: Historial de movimientos de inventario entre sucursales
-- ----------------------------------------------------------------------------
SELECT 
    mi.id_movimiento,
    mi.fecha,
    p.nombre AS producto,
    so.nombre AS sucursal_origen,
    sd.nombre AS sucursal_destino,
    mi.cantidad_unidades AS unidades_transferidas,
    u.nombre_completo AS responsable,
    mi.observaciones
FROM movimientos_inventario mi
INNER JOIN productos p ON mi.id_producto = p.id_producto
INNER JOIN sucursales so ON mi.id_sucursal_origen = so.id_sucursal
INNER JOIN sucursales sd ON mi.id_sucursal_destino = sd.id_sucursal
INNER JOIN usuarios u ON mi.id_usuario = u.id_usuario
ORDER BY mi.fecha DESC;


-- ----------------------------------------------------------------------------
-- Consulta 9: Evaluación de Proveedores (Total compras y tiempos de entrega)
-- ----------------------------------------------------------------------------
SELECT 
    pr.nombre AS proveedor,
    COUNT(c.id_compra) AS total_compras,
    SUM(c.total) AS facturado_total,
    SUM(cd.descuento) AS total_descuentos,
    AVG(DATEDIFF(cd.fecha_entrega, c.fecha)) AS dias_promedio_entrega
FROM proveedores pr
INNER JOIN compras c ON pr.id_proveedor = c.id_proveedor
INNER JOIN compra_detalle cd ON c.id_compra = cd.id_compra
WHERE c.estado = 'Activa'
GROUP BY pr.nombre
ORDER BY facturado_total DESC;


-- ----------------------------------------------------------------------------
-- Consulta 10: Cantidad de ventas e ingresos por hora
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    DAYOFWEEK(v.fecha) AS dia_semana_numero,
    HOUR(v.fecha) AS hora_dia,
    COUNT(v.id_venta) AS transacciones,
    SUM(v.total) AS ingresos_totales
FROM ventas v
INNER JOIN sucursales s ON v.id_sucursal = s.id_sucursal
WHERE v.estado = 'Completada'
GROUP BY s.nombre, DAYOFWEEK(v.fecha), HOUR(v.fecha)
ORDER BY ingresos_totales DESC;


-- ----------------------------------------------------------------------------
-- Consulta 11: Auditoría de ventas anuladas por cajero
-- ----------------------------------------------------------------------------
SELECT 
    u.nombre_completo AS cajero,
    COUNT(v.id_venta) AS total_intentos,
    SUM(IF(v.estado = 'Completada', 1, 0)) AS ventas_completadas,
    SUM(IF(v.estado = 'Anulada', 1, 0)) AS ventas_anuladas,
    SUM(IF(v.estado = 'Anulada', v.total, 0)) AS monto_anulado
FROM usuarios u
INNER JOIN ventas v ON u.id_usuario = v.id_usuario
GROUP BY u.nombre_completo
ORDER BY ventas_anuladas DESC;


-- ----------------------------------------------------------------------------
-- Consulta 12: Productos con stock pero sin ventas registradas en los últimos 30 días
-- ----------------------------------------------------------------------------
SELECT 
    p.nombre AS producto,
    c.nombre AS categoria,
    s.nombre AS sucursal,
    inv.stock AS stock_actual,
    (inv.stock * inv.precio_costo) AS capital_estancado
FROM inventario inv
INNER JOIN productos p ON inv.id_producto = p.id_producto
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
INNER JOIN sucursales s ON inv.id_sucursal = s.id_sucursal
LEFT JOIN (
    SELECT DISTINCT vd.id_producto, v.id_sucursal
    FROM venta_detalle vd
    INNER JOIN ventas v ON vd.id_venta = v.id_venta
    WHERE v.estado = 'Completada' AND v.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
) v_recientes ON p.id_producto = v_recientes.id_producto AND s.id_sucursal = v_recientes.id_sucursal
WHERE p.id_estado = 1 AND inv.stock > 0 AND v_recientes.id_producto IS NULL
ORDER BY capital_estancado DESC;


-- ----------------------------------------------------------------------------
-- Consulta 13: Total de ventas mensuales de todo el sistema
-- ----------------------------------------------------------------------------
SELECT 
    DATE_FORMAT(fecha, '%Y-%m') AS mes,
    SUM(total) AS total_ventas
FROM ventas
WHERE estado = 'Completada'
GROUP BY DATE_FORMAT(fecha, '%Y-%m')
ORDER BY mes;


-- ----------------------------------------------------------------------------
-- Consulta 14: Pérdida proyectada por productos que vencen en los próximos 90 días
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    p.nombre AS producto,
    i.lote,
    i.fecha_vencimiento,
    i.stock AS stock_actual,
    (i.stock * i.precio_costo) AS perdida_proyectada
FROM inventario i
INNER JOIN productos p ON i.id_producto = p.id_producto
INNER JOIN sucursales s ON i.id_sucursal = s.id_sucursal
WHERE i.fecha_vencimiento IS NOT NULL 
  AND i.stock > 0
  AND i.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
ORDER BY i.fecha_vencimiento ASC;


-- ----------------------------------------------------------------------------
-- Consulta 15: Resumen general de cierres de caja diario
-- ----------------------------------------------------------------------------
SELECT 
    s.nombre AS sucursal,
    ac.fecha,
    ac.efectivo_inicial,
    ac.ventas_efectivo,
    ac.gastos_aprobados,
    ac.efectivo_esperado,
    ac.efectivo_contado,
    ac.diferencia,
    ac.estado AS estado_arqueo
FROM arqueos_caja ac
INNER JOIN sucursales s ON ac.id_sucursal = s.id_sucursal
ORDER BY ac.fecha DESC;


-- ----------------------------------------------------------------------------
-- Consulta 16: Ventas totales acumuladas por método de pago
-- ----------------------------------------------------------------------------
SELECT 
    metodo_pago,
    COUNT(id_venta) AS cantidad_transacciones,
    SUM(total) AS total_recaudado
FROM ventas
WHERE estado = 'Completada'
GROUP BY metodo_pago
ORDER BY total_recaudado DESC;


-- ----------------------------------------------------------------------------
-- Consulta 17: Top 10 productos más vendidos en el sistema por cantidad
-- ----------------------------------------------------------------------------
SELECT 
    p.nombre AS producto,
    c.nombre AS categoria,
    SUM(vd.cantidad) AS cantidad_total_vendida,
    SUM(vd.total) AS total_ingresos
FROM venta_detalle vd
INNER JOIN ventas v ON vd.id_venta = v.id_venta
INNER JOIN productos p ON vd.id_producto = p.id_producto
INNER JOIN categorias c ON p.id_categoria = c.id_categoria
WHERE v.estado = 'Completada' AND vd.estado = 'Vendido'
GROUP BY p.id_producto, p.nombre, c.nombre
ORDER BY cantidad_total_vendida DESC
LIMIT 10;


-- ============================================================================
-- PROCEDIMIENTOS ALMACENADOS (NO COMPLEJOS)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Procedimiento 1: Obtener el stock detallado de un producto por sucursal
-- ----------------------------------------------------------------------------
DELIMITER //

DROP PROCEDURE IF EXISTS sp_obtener_stock_producto//

CREATE PROCEDURE sp_obtener_stock_producto(
    IN p_id_producto INT,
    IN p_id_sucursal INT
)
BEGIN
    SELECT 
        p.nombre AS producto,
        s.nombre AS sucursal,
        COALESCE(SUM(CASE WHEN i.ubicacion = 'Bodega' THEN i.stock ELSE 0 END), 0) AS stock_bodega,
        COALESCE(SUM(CASE WHEN i.ubicacion = 'Mostrador' THEN i.stock ELSE 0 END), 0) AS stock_mostrador,
        COALESCE(SUM(i.stock), 0) AS stock_total
    FROM productos p
    CROSS JOIN sucursales s
    LEFT JOIN inventario i ON p.id_producto = i.id_producto AND s.id_sucursal = i.id_sucursal
    WHERE p.id_producto = p_id_producto AND s.id_sucursal = p_id_sucursal
    GROUP BY p.id_producto, p.nombre, s.id_sucursal, s.nombre;
END//

DELIMITER ;


-- ----------------------------------------------------------------------------
-- Procedimiento 2: Actualizar el precio de venta de un producto con validación
-- ----------------------------------------------------------------------------
DELIMITER //

DROP PROCEDURE IF EXISTS sp_actualizar_precio_producto//

CREATE PROCEDURE sp_actualizar_precio_producto(
    IN p_id_producto INT,
    IN p_nuevo_precio DECIMAL(10,2)
)
BEGIN
    -- Validación básica de negocio: El precio de venta debe ser positivo
    IF p_nuevo_precio <= 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Error: El precio de venta debe ser mayor que cero.';
    ELSE
        UPDATE productos
        SET precio_venta = p_nuevo_precio
        WHERE id_producto = p_id_producto;
        
        -- Confirmar fila afectada
        SELECT p_id_producto AS id_producto, p_nuevo_precio AS nuevo_precio, 'Precio actualizado con éxito' AS resultado;
    END IF;
END//

DELIMITER ;
