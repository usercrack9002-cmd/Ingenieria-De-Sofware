-- ============================================================================
-- Triggers de InvVentas Licor
-- Ejecutar en MySQL Workbench conectado como root (requiere privilegios para
-- crear triggers con el registro binario activo).
-- ============================================================================
USE invventas_licor;

DROP TRIGGER IF EXISTS trg_movimiento_validar_insert;
DROP TRIGGER IF EXISTS trg_movimiento_validar_update;
DROP TRIGGER IF EXISTS trg_compra_detalle_calcular_insert;
DROP TRIGGER IF EXISTS trg_compra_detalle_calcular_update;

DELIMITER //

-- Validar que origen y destino sean distintos (INSERT)
CREATE TRIGGER trg_movimiento_validar_insert
BEFORE INSERT ON movimientos_inventario
FOR EACH ROW
BEGIN
    IF NEW.id_sucursal_origen = NEW.id_sucursal_destino THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La sucursal de origen y destino no pueden ser la misma.';
    END IF;
END //

-- Validar que origen y destino sean distintos (UPDATE)
CREATE TRIGGER trg_movimiento_validar_update
BEFORE UPDATE ON movimientos_inventario
FOR EACH ROW
BEGIN
    IF NEW.id_sucursal_origen = NEW.id_sucursal_destino THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La sucursal de origen y destino no pueden ser la misma.';
    END IF;
END //

-- Cálculo automático de precio unitario en compra_detalle (INSERT)
CREATE TRIGGER trg_compra_detalle_calcular_insert
BEFORE INSERT ON compra_detalle
FOR EACH ROW
BEGIN
    DECLARE v_subtotal_bruto DECIMAL(12,2);
    DECLARE v_base_descuento DECIMAL(12,2);
    DECLARE v_cantidad_total_recibida INT;
    DECLARE v_equiv INT DEFAULT 1;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_equiv = 1;

    IF NEW.cantidad_unidades = 0 THEN
        IF NEW.id_agrupacion IS NOT NULL THEN
            SELECT equivalencia_unidades INTO v_equiv
            FROM producto_agrupaciones
            WHERE id_producto = NEW.id_producto
              AND id_agrupacion = NEW.id_agrupacion
            LIMIT 1;
        END IF;
        SET NEW.cantidad_unidades = NEW.cantidad_agrupacion * v_equiv;
    END IF;

    SET v_subtotal_bruto = NEW.cantidad_agrupacion * NEW.precio_costo;
    SET v_base_descuento = v_subtotal_bruto - NEW.descuento;
    SET NEW.iva_monto = IF(v_base_descuento > 0,
        ROUND(v_base_descuento * (NEW.iva_porcentaje / 100), 2), 0);
    SET NEW.subtotal_neto = GREATEST(0, ROUND(v_base_descuento + NEW.iva_monto, 2));
    SET v_cantidad_total_recibida = NEW.cantidad_unidades + NEW.bonificacion;
    SET NEW.precio_unitario_neto = IF(v_cantidad_total_recibida > 0,
        ROUND(NEW.subtotal_neto / v_cantidad_total_recibida, 2), 0);
    SET NEW.precio_venta_sugerido = ROUND(
        NEW.precio_unitario_neto * (1 + IFNULL(NEW.margen_ganancia, 20) / 100), 2);
END //

-- Cálculo automático de precio unitario en compra_detalle (UPDATE)
CREATE TRIGGER trg_compra_detalle_calcular_update
BEFORE UPDATE ON compra_detalle
FOR EACH ROW
BEGIN
    DECLARE v_subtotal_bruto DECIMAL(12,2);
    DECLARE v_base_descuento DECIMAL(12,2);
    DECLARE v_cantidad_total_recibida INT;
    DECLARE v_equiv INT DEFAULT 1;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_equiv = 1;

    IF NEW.id_agrupacion IS NOT NULL THEN
        SELECT equivalencia_unidades INTO v_equiv
        FROM producto_agrupaciones
        WHERE id_producto = NEW.id_producto
          AND id_agrupacion = NEW.id_agrupacion
        LIMIT 1;
    END IF;
    SET NEW.cantidad_unidades = NEW.cantidad_agrupacion * v_equiv;

    SET v_subtotal_bruto = NEW.cantidad_agrupacion * NEW.precio_costo;
    SET v_base_descuento = v_subtotal_bruto - NEW.descuento;
    SET NEW.iva_monto = IF(v_base_descuento > 0,
        ROUND(v_base_descuento * (NEW.iva_porcentaje / 100), 2), 0);
    SET NEW.subtotal_neto = GREATEST(0, ROUND(v_base_descuento + NEW.iva_monto, 2));
    SET v_cantidad_total_recibida = NEW.cantidad_unidades + NEW.bonificacion;
    SET NEW.precio_unitario_neto = IF(v_cantidad_total_recibida > 0,
        ROUND(NEW.subtotal_neto / v_cantidad_total_recibida, 2), 0);
    SET NEW.precio_venta_sugerido = ROUND(
        NEW.precio_unitario_neto * (1 + IFNULL(NEW.margen_ganancia, 20) / 100), 2);
END //

DELIMITER ;

SHOW TRIGGERS FROM invventas_licor;
