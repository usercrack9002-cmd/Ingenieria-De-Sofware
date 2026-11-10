-- ============================================================================
-- BASE DE DATOS: InvVentas Licor
-- Sistema de Inventario, Ventas y Control para Licorería
-- Compatible con MySQL 8.0+ / MySQL Workbench
-- Fecha de creación: 2026-06-15
-- ============================================================================
DROP DATABASE IF EXISTS invventas_licor;
CREATE DATABASE invventas_licor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE invventas_licor;

-- ============================================================================
-- 0. TABLA: estados
-- Catálogo maestro de estados (Activo, Inactivo, etc.)
-- ============================================================================
CREATE TABLE estados (
    id_estado INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

INSERT INTO estados (id_estado, nombre) VALUES
    (1, 'Activo'),
    (2, 'Inactivo');

-- ============================================================================
-- 1. TABLA: sucursales
-- Representa cada punto físico de la licorería (Central, Plaza, Norte, etc.)
-- ============================================================================
CREATE TABLE sucursales (
    id_sucursal     INT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL UNIQUE,
    direccion       VARCHAR(255) DEFAULT NULL,
    telefono        VARCHAR(20)  DEFAULT NULL,
    id_estado       INT NOT NULL DEFAULT 1,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_sucursal_estado
        FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Datos iniciales de sucursales según el sistema
INSERT INTO sucursales (nombre) VALUES
    ('Central'),
    ('Plaza'),
    ('Norte');

-- ============================================================================
-- 2. TABLA: roles
-- Catálogo de roles del sistema con sus permisos
-- ============================================================================
CREATE TABLE roles (
    id_rol  INT AUTO_INCREMENT PRIMARY KEY,
    nombre  VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB;

INSERT INTO roles (nombre, descripcion) VALUES
    ('Gerente', 'Acceso total al sistema, todas las sucursales'),
    ('Administrador', 'Gestión avanzada de una sucursal'),
    ('Vendedor', 'Punto de venta y operaciones básicas');

-- ============================================================================
-- 3. TABLA: usuarios
-- Usuarios del sistema (gerentes, administradores, vendedores)
-- ============================================================================
CREATE TABLE usuarios (
    id_usuario      INT AUTO_INCREMENT PRIMARY KEY,
    nombre_completo VARCHAR(150) NOT NULL,
    usuario         VARCHAR(50)  NOT NULL UNIQUE,
    contrasena      VARCHAR(255) NOT NULL COMMENT 'Hash de la contraseña',
    id_rol          INT NOT NULL,
    id_sucursal     INT DEFAULT NULL COMMENT 'NULL si es gerente (acceso a todas)',
    id_estado       INT NOT NULL DEFAULT 1,
    ultima_sesion   DATETIME DEFAULT NULL,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_usuario_rol
        FOREIGN KEY (id_rol) REFERENCES roles(id_rol)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_usuario_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT fk_usuario_estado
        FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ============================================================================
-- 3b. TABLA: sesiones
-- Registro de sesiones de usuarios en el sistema
-- ============================================================================
CREATE TABLE sesiones (
    id_sesion       INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario      INT NOT NULL,
    id_sucursal     INT DEFAULT NULL,
    fecha_inicio    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_fin       DATETIME DEFAULT NULL,
    activa          TINYINT(1) NOT NULL DEFAULT 1,

    CONSTRAINT fk_sesion_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_sesion_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ==============================================================================================
-- 4. TABLA: categorias
-- Categorías de productos (Licores, Cervezas, Vinos, Cigarros, etc.)
-- ============================================================================
CREATE TABLE categorias (
    id_categoria    INT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL UNIQUE,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO categorias (nombre) VALUES
    ('Licores'),
    ('Cervezas'),
    ('Vinos'),
    ('Cigarros'),
    ('Bebidas'),
    ('Snacks');

-- ============================================================================
-- 5. TABLA: productos
-- Catálogo maestro de productos
-- ============================================================================
CREATE TABLE productos (
    id_producto     INT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(200) NOT NULL,
    id_categoria    INT NOT NULL,
    precio_venta    DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Precio de venta unitario actual',
    id_estado       INT NOT NULL DEFAULT 1,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_producto_categoria
        FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_producto_estado
        FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    INDEX idx_producto_nombre (nombre),
    INDEX idx_producto_categoria (id_categoria)
) ENGINE=InnoDB;

-- ============================================================================
-- 6. TABLA: agrupaciones
-- Tipos de agrupación genéricos del sistema (Unidad, Six Pack, Caja, etc.)
-- ============================================================================
CREATE TABLE agrupaciones (
    id_agrupacion   INT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL UNIQUE COMMENT 'Ej: Unidad, Paquete, Six Pack, Caja, Cajilla, Botella, Media Botella',
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO agrupaciones (nombre) VALUES
    ('Unidad'),
    ('Paquete'),
    ('Six Pack'),
    ('Caja'),
    ('Cajilla'),
    ('Botella'),
    ('Media Botella');

-- ============================================================================
-- 7. TABLA: producto_agrupaciones
-- Relación M:N entre productos y agrupaciones, con su equivalencia en unidades
-- Define cuáles agrupaciones permite cada producto y cuántas unidades contiene
-- ============================================================================
CREATE TABLE producto_agrupaciones (
    id_producto_agrupacion INT AUTO_INCREMENT PRIMARY KEY,
    id_producto     INT NOT NULL,
    id_agrupacion   INT NOT NULL,
    equivalencia_unidades INT NOT NULL DEFAULT 1 COMMENT 'Cuántas unidades equivale esta agrupación',

    CONSTRAINT fk_prodagrup_producto
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_prodagrup_agrupacion
        FOREIGN KEY (id_agrupacion) REFERENCES agrupaciones(id_agrupacion)
        ON UPDATE CASCADE ON DELETE CASCADE,

    UNIQUE KEY uk_producto_agrupacion (id_producto, id_agrupacion)
) ENGINE=InnoDB;

-- ============================================================================
-- 8. TABLA: precios_agrupacion
-- Precios especiales por volumen/agrupación (venta por mayor)
-- Un producto puede tener un precio distinto cuando se vende en Six Pack, Caja, etc.
-- ============================================================================
CREATE TABLE precios_agrupacion (
    id_precio_agrupacion INT AUTO_INCREMENT PRIMARY KEY,
    id_producto     INT NOT NULL,
    id_agrupacion   INT NOT NULL,
    precio          DECIMAL(10,2) NOT NULL COMMENT 'Precio de venta para esta agrupación',
    descuento_porcentaje DECIMAL(5,2) DEFAULT 0.00 COMMENT 'Descuento aplicado respecto al precio unitario',
    activo          TINYINT(1) NOT NULL DEFAULT 1,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_precioagrup_producto
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_precioagrup_agrupacion
        FOREIGN KEY (id_agrupacion) REFERENCES agrupaciones(id_agrupacion)
        ON UPDATE CASCADE ON DELETE CASCADE,

    UNIQUE KEY uk_precio_prod_agrup (id_producto, id_agrupacion)
) ENGINE=InnoDB;

-- ============================================================================
-- 9. TABLA: inventario
-- Stock de cada producto por sucursal y ubicación (Bodega/Mostrador)
-- Maneja lotes y fechas de vencimiento
-- ============================================================================
CREATE TABLE inventario (
    id_inventario   INT AUTO_INCREMENT PRIMARY KEY,
    id_producto     INT NOT NULL,
    id_sucursal     INT NOT NULL,
    ubicacion       ENUM('Bodega', 'Mostrador') NOT NULL DEFAULT 'Bodega',
    stock           INT NOT NULL DEFAULT 0 COMMENT 'Stock en unidades',
    stock_minimo    INT NOT NULL DEFAULT 5 COMMENT 'Umbral para alerta de stock bajo',
    lote            VARCHAR(50) DEFAULT NULL,
    fecha_vencimiento DATE DEFAULT NULL,
    precio_costo    DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Precio de costo unitario de este lote',
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_inventario_producto
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_inventario_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE CASCADE,

    INDEX idx_inventario_producto (id_producto),
    INDEX idx_inventario_sucursal (id_sucursal),
    INDEX idx_inventario_vencimiento (fecha_vencimiento),
    INDEX idx_inventario_stock (stock)
) ENGINE=InnoDB;

-- ============================================================================
-- 10. TABLA: proveedores
-- Proveedores de la licorería
-- ============================================================================
CREATE TABLE proveedores (
    id_proveedor    INT AUTO_INCREMENT PRIMARY KEY,
    nombre          VARCHAR(200) NOT NULL,
    contacto        VARCHAR(150) DEFAULT NULL COMMENT 'Persona de contacto',
    telefono        VARCHAR(30)  DEFAULT NULL,
    correo          VARCHAR(150) DEFAULT NULL,
    id_sucursal     INT NOT NULL DEFAULT 1,
    id_estado       INT NOT NULL DEFAULT 1,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_proveedor_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_proveedor_estado
        FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    INDEX idx_proveedor_nombre (nombre),
    INDEX idx_proveedor_sucursal (id_sucursal)
) ENGINE=InnoDB;

-- ============================================================================
-- 11. TABLA: compras
-- Cabecera de las facturas de compra realizadas a proveedores
-- ============================================================================
CREATE TABLE compras (
    id_compra       INT AUTO_INCREMENT PRIMARY KEY,
    numero_factura  VARCHAR(50)  NOT NULL UNIQUE,
    fecha           DATE NOT NULL,
    id_proveedor    INT NOT NULL,
    id_usuario      INT NOT NULL COMMENT 'Usuario que realizó la compra',
    id_sucursal     INT NOT NULL DEFAULT 1,
    metodo_pago     ENUM('Efectivo', 'Tarjeta', 'Transferencia') NOT NULL DEFAULT 'Efectivo',
    subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    iva_total       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    estado          ENUM('Activa', 'Anulada') NOT NULL DEFAULT 'Activa',
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_compra_proveedor
        FOREIGN KEY (id_proveedor) REFERENCES proveedores(id_proveedor)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_compra_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_compra_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    INDEX idx_compra_fecha (fecha),
    INDEX idx_compra_proveedor (id_proveedor),
    INDEX idx_compra_sucursal (id_sucursal)
) ENGINE=InnoDB;

-- ============================================================================
-- 12. TABLA: compra_detalle
-- Detalle de cada producto en una factura de compra
-- ============================================================================
CREATE TABLE compra_detalle (
    id_compra_detalle INT AUTO_INCREMENT PRIMARY KEY,
    id_compra       INT NOT NULL,
    id_producto     INT NOT NULL,
    id_agrupacion   INT DEFAULT NULL COMMENT 'Agrupación usada en la compra',
    cantidad_agrupacion INT NOT NULL DEFAULT 1 COMMENT 'Cantidad de cajas/packs comprados',
    cantidad_unidades INT NOT NULL DEFAULT 0 COMMENT 'Cantidad total en unidades (auto-calculado por trigger)',
    precio_costo    DECIMAL(10,2) NOT NULL COMMENT 'Precio de compra por agrupación',
    iva_porcentaje  DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    iva_monto       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    descuento       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    bonificacion    INT NOT NULL DEFAULT 0 COMMENT 'Unidades gratis (bonificación)',
    lote            VARCHAR(50) DEFAULT NULL,
    fecha_entrega   DATE DEFAULT NULL,
    fecha_caducidad DATE DEFAULT NULL,
    precio_unitario_neto DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Costo unitario neto calculado',
    precio_venta_sugerido DECIMAL(10,2) DEFAULT NULL COMMENT 'Precio venta sugerido según margen',
    margen_ganancia DECIMAL(5,2) DEFAULT 20.00 COMMENT 'Porcentaje de ganancia deseado',
    subtotal_neto   DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT fk_compradet_compra
        FOREIGN KEY (id_compra) REFERENCES compras(id_compra)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_compradet_producto
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_compradet_agrupacion
        FOREIGN KEY (id_agrupacion) REFERENCES agrupaciones(id_agrupacion)
        ON UPDATE CASCADE ON DELETE SET NULL,

    INDEX idx_compradet_compra (id_compra),
    INDEX idx_compradet_producto (id_producto)
) ENGINE=InnoDB;

-- ============================================================================
-- 13. TABLA: ventas
-- Cabecera de cada transacción de venta realizada en el punto de venta
-- ============================================================================
CREATE TABLE ventas (
    id_venta        INT AUTO_INCREMENT PRIMARY KEY,
    codigo_venta    VARCHAR(20) NOT NULL UNIQUE COMMENT 'Ej: VTA-0001',
    fecha           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_usuario      INT NOT NULL COMMENT 'Vendedor que realizó la venta',
    id_sucursal     INT NOT NULL,
    metodo_pago     ENUM('Efectivo', 'Tarjeta', 'Transferencia') NOT NULL DEFAULT 'Efectivo',
    subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    iva_total       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    pago_recibido   DECIMAL(12,2) DEFAULT NULL COMMENT 'Monto recibido del cliente',
    cambio          DECIMAL(12,2) DEFAULT NULL COMMENT 'Cambio devuelto',
    estado          ENUM('Completada', 'Anulada') NOT NULL DEFAULT 'Completada',
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_venta_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_venta_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    INDEX idx_venta_fecha (fecha),
    INDEX idx_venta_usuario (id_usuario),
    INDEX idx_venta_sucursal (id_sucursal),
    INDEX idx_venta_metodo_pago (metodo_pago),
    INDEX idx_venta_estado (estado)
) ENGINE=InnoDB;

-- ============================================================================
-- 14. TABLA: venta_detalle
-- Detalle de cada producto vendido en una transacción
-- ============================================================================
CREATE TABLE venta_detalle (
    id_venta_detalle INT AUTO_INCREMENT PRIMARY KEY,
    id_venta        INT NOT NULL,
    id_producto     INT NOT NULL,
    id_inventario   INT DEFAULT NULL COMMENT 'Referencia al lote de inventario usado',
    id_agrupacion   INT DEFAULT NULL COMMENT 'Agrupación usada en la venta',
    cantidad        INT NOT NULL COMMENT 'Cantidad vendida en unidades',
    precio_unitario DECIMAL(10,2) NOT NULL COMMENT 'Precio unitario al momento de la venta',
    subtotal        DECIMAL(12,2) NOT NULL,
    iva             DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Monto de IVA de la línea',
    total           DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Total de la línea (subtotal + iva)',
    estado          ENUM('Vendido', 'Anulado') NOT NULL DEFAULT 'Vendido',

    CONSTRAINT fk_ventadet_venta
        FOREIGN KEY (id_venta) REFERENCES ventas(id_venta)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_ventadet_producto
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_ventadet_inventario
        FOREIGN KEY (id_inventario) REFERENCES inventario(id_inventario)
        ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT fk_ventadet_agrupacion
        FOREIGN KEY (id_agrupacion) REFERENCES agrupaciones(id_agrupacion)
        ON UPDATE CASCADE ON DELETE SET NULL,

    INDEX idx_ventadet_venta (id_venta),
    INDEX idx_ventadet_producto (id_producto)
) ENGINE=InnoDB;

-- ============================================================================
-- 15. TABLA: anulaciones
-- Solicitudes de anulación de ventas (flujo de aprobación)
-- ============================================================================
CREATE TABLE anulaciones (
    id_anulacion    INT AUTO_INCREMENT PRIMARY KEY,
    id_venta        INT NOT NULL,
    fecha           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_usuario_solicitante INT NOT NULL COMMENT 'Vendedor que solicita la anulación',
    id_usuario_admin INT DEFAULT NULL COMMENT 'Admin/Gerente asignado para aprobar',
    motivo          TEXT NOT NULL COMMENT 'Motivo de la anulación',
    estado          ENUM('Pendiente', 'Aprobada', 'Rechazada') NOT NULL DEFAULT 'Pendiente',
    fecha_resolucion DATETIME DEFAULT NULL COMMENT 'Fecha en que se aprobó/rechazó',
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_anulacion_venta
        FOREIGN KEY (id_venta) REFERENCES ventas(id_venta)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_anulacion_solicitante
        FOREIGN KEY (id_usuario_solicitante) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_anulacion_admin
        FOREIGN KEY (id_usuario_admin) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE SET NULL,

    INDEX idx_anulacion_estado (estado),
    INDEX idx_anulacion_fecha (fecha)
) ENGINE=InnoDB;

-- ============================================================================
-- 16. TABLA: gastos
-- Solicitudes de salida de efectivo de la caja
-- ============================================================================
CREATE TABLE gastos (
    id_gasto        INT AUTO_INCREMENT PRIMARY KEY,
    fecha           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    monto           DECIMAL(12,2) NOT NULL,
    motivo          TEXT NOT NULL COMMENT 'Razón de pago / Justificación',
    id_usuario_solicitante INT NOT NULL COMMENT 'Usuario que solicita el gasto',
    id_usuario_admin INT DEFAULT NULL COMMENT 'Admin que autoriza',
    id_sucursal     INT NOT NULL,
    estado          ENUM('Pendiente', 'Aprobado', 'Rechazado') NOT NULL DEFAULT 'Pendiente',
    fecha_resolucion DATETIME DEFAULT NULL,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_gasto_solicitante
        FOREIGN KEY (id_usuario_solicitante) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_gasto_admin
        FOREIGN KEY (id_usuario_admin) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT fk_gasto_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    INDEX idx_gasto_fecha (fecha),
    INDEX idx_gasto_estado (estado),
    INDEX idx_gasto_sucursal (id_sucursal)
) ENGINE=InnoDB;



-- ============================================================================
-- 17. TABLA: arqueos_caja
-- Registro de los arqueos de caja diarios
-- ============================================================================
CREATE TABLE arqueos_caja (
    id_arqueo       INT AUTO_INCREMENT PRIMARY KEY,
    fecha           DATE NOT NULL,
    id_usuario      INT NOT NULL COMMENT 'Cajero que realiza el arqueo',
    id_sucursal     INT NOT NULL,
    efectivo_inicial DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Fondo fijo de apertura',
    ventas_efectivo DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Total ventas en efectivo del día',
    gastos_aprobados DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Total gastos aprobados descontados',
    efectivo_esperado DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Calculado: inicial + ventas - gastos',
    efectivo_contado DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Conteo físico real',
    diferencia      DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Contado - Esperado',
    estado          ENUM('Cuadrada', 'Faltante', 'Sobrante', 'Sin Conteo', 'Abierto') NOT NULL DEFAULT 'Sin Conteo',
    observaciones   TEXT DEFAULT NULL,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_arqueo_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_arqueo_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    INDEX idx_arqueo_fecha (fecha),
    INDEX idx_arqueo_sucursal (id_sucursal)
) ENGINE=InnoDB;

-- ============================================================================
-- 18. TABLA: arqueo_denominaciones
-- Detalle del conteo físico de cada denominación en un arqueo
-- ============================================================================
CREATE TABLE arqueo_denominaciones (
    id_denominacion INT AUTO_INCREMENT PRIMARY KEY,
    id_arqueo       INT NOT NULL,
    denominacion    DECIMAL(10,2) NOT NULL COMMENT 'Valor de la moneda o billete (1, 5, 10, 20, 50, 100, 200, 500, 1000)',
    cantidad        INT NOT NULL DEFAULT 0 COMMENT 'Cantidad de billetes/monedas contados',
    subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'denominacion × cantidad',

    CONSTRAINT fk_arqdenom_arqueo
        FOREIGN KEY (id_arqueo) REFERENCES arqueos_caja(id_arqueo)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- 19. TABLA: movimientos_inventario
-- Transferencias de productos entre sucursales
-- ============================================================================
CREATE TABLE movimientos_inventario (
    id_movimiento   INT AUTO_INCREMENT PRIMARY KEY,
    fecha           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_producto     INT NOT NULL,
    id_sucursal_origen  INT NOT NULL,
    id_sucursal_destino INT NOT NULL,
    id_agrupacion   INT DEFAULT NULL COMMENT 'Agrupación usada para el movimiento',
    cantidad_agrupacion INT NOT NULL DEFAULT 1 COMMENT 'Cantidad de agrupaciones movidas',
    cantidad_unidades INT NOT NULL COMMENT 'Equivalencia total en unidades',
    id_usuario      INT NOT NULL COMMENT 'Usuario que realizó el movimiento',
    observaciones   TEXT DEFAULT NULL,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_movimiento_producto
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_movimiento_origen
        FOREIGN KEY (id_sucursal_origen) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_movimiento_destino
        FOREIGN KEY (id_sucursal_destino) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_movimiento_agrupacion
        FOREIGN KEY (id_agrupacion) REFERENCES agrupaciones(id_agrupacion)
        ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT fk_movimiento_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    INDEX idx_movimiento_fecha (fecha),
    INDEX idx_movimiento_producto (id_producto),
    INDEX idx_movimiento_origen (id_sucursal_origen),
    INDEX idx_movimiento_destino (id_sucursal_destino)
) ENGINE=InnoDB;

-- Trigger para validar que origen y destino sean distintos (INSERT)
DELIMITER //
CREATE TRIGGER trg_movimiento_validar_insert
BEFORE INSERT ON movimientos_inventario
FOR EACH ROW
BEGIN
    IF NEW.id_sucursal_origen = NEW.id_sucursal_destino THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La sucursal de origen y destino no pueden ser la misma.';
    END IF;
END //

-- Trigger para validar que origen y destino sean distintos (UPDATE)
CREATE TRIGGER trg_movimiento_validar_update
BEFORE UPDATE ON movimientos_inventario
FOR EACH ROW
BEGIN
    IF NEW.id_sucursal_origen = NEW.id_sucursal_destino THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'La sucursal de origen y destino no pueden ser la misma.';
    END IF;
END //
DELIMITER ;

-- ============================================================================
-- TRIGGERS: Cálculo automático de precio unitario en compra_detalle
-- Implementación de la fórmula:
--   subtotalBruto          = cantidad × costo
--   baseDescuento          = subtotalBruto - descuento
--   ivaCalculado           = baseDescuento > 0 ? baseDescuento × (ivaPct/100) : 0
--   totalNeto              = MAX(0, baseDescuento + ivaCalculado)
--   cantidadTotalRecibida  = cantidadUnidades + bonificación
--   precioUnitarioNeto     = totalNeto / cantidadTotalRecibida
--   precioVentaSugerido    = precioUnitarioNeto × (1 + margen/100)
-- ============================================================================
DELIMITER //

CREATE TRIGGER trg_compra_detalle_calcular_insert
BEFORE INSERT ON compra_detalle
FOR EACH ROW
BEGIN
    DECLARE v_subtotal_bruto DECIMAL(12,2);
    DECLARE v_base_descuento DECIMAL(12,2);
    DECLARE v_cantidad_total_recibida INT;
    DECLARE v_equiv INT DEFAULT 1;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_equiv = 1;

    -- Auto-calcular cantidad_unidades desde la equivalencia de agrupación
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

    -- subtotalBruto = cantidad × costo
    SET v_subtotal_bruto = NEW.cantidad_agrupacion * NEW.precio_costo;

    -- baseDescuento = subtotalBruto - descuento
    SET v_base_descuento = v_subtotal_bruto - NEW.descuento;

    -- ivaCalculado = baseDescuento > 0 ? baseDescuento × (ivaPct / 100) : 0
    SET NEW.iva_monto = IF(v_base_descuento > 0,
        ROUND(v_base_descuento * (NEW.iva_porcentaje / 100), 2), 0);

    -- totalNeto = MAX(0, baseDescuento + ivaCalculado)
    SET NEW.subtotal_neto = GREATEST(0, ROUND(v_base_descuento + NEW.iva_monto, 2));

    -- cantidadTotalRecibida = cantidad + bonificacion
    SET v_cantidad_total_recibida = NEW.cantidad_unidades + NEW.bonificacion;

    -- precioUnitarioNeto = totalNeto / cantidadTotalRecibida
    SET NEW.precio_unitario_neto = IF(v_cantidad_total_recibida > 0,
        ROUND(NEW.subtotal_neto / v_cantidad_total_recibida, 2), 0);

    -- precioVentaSugerido = precioUnitarioNeto × (1 + margen/100)
    SET NEW.precio_venta_sugerido = ROUND(
        NEW.precio_unitario_neto * (1 + IFNULL(NEW.margen_ganancia, 20) / 100), 2);
END //

CREATE TRIGGER trg_compra_detalle_calcular_update
BEFORE UPDATE ON compra_detalle
FOR EACH ROW
BEGIN
    DECLARE v_subtotal_bruto DECIMAL(12,2);
    DECLARE v_base_descuento DECIMAL(12,2);
    DECLARE v_cantidad_total_recibida INT;
    DECLARE v_equiv INT DEFAULT 1;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_equiv = 1;

    -- Recalcular cantidad_unidades desde agrupación
    IF NEW.id_agrupacion IS NOT NULL THEN
        SELECT equivalencia_unidades INTO v_equiv
        FROM producto_agrupaciones
        WHERE id_producto = NEW.id_producto
          AND id_agrupacion = NEW.id_agrupacion
        LIMIT 1;
    END IF;
    SET NEW.cantidad_unidades = NEW.cantidad_agrupacion * v_equiv;

    -- subtotalBruto = cantidad × costo
    SET v_subtotal_bruto = NEW.cantidad_agrupacion * NEW.precio_costo;

    -- baseDescuento = subtotalBruto - descuento
    SET v_base_descuento = v_subtotal_bruto - NEW.descuento;

    -- ivaCalculado = baseDescuento > 0 ? baseDescuento × (ivaPct / 100) : 0
    SET NEW.iva_monto = IF(v_base_descuento > 0,
        ROUND(v_base_descuento * (NEW.iva_porcentaje / 100), 2), 0);

    -- totalNeto = MAX(0, baseDescuento + ivaCalculado)
    SET NEW.subtotal_neto = GREATEST(0, ROUND(v_base_descuento + NEW.iva_monto, 2));

    -- cantidadTotalRecibida = cantidad + bonificacion
    SET v_cantidad_total_recibida = NEW.cantidad_unidades + NEW.bonificacion;

    -- precioUnitarioNeto = totalNeto / cantidadTotalRecibida
    SET NEW.precio_unitario_neto = IF(v_cantidad_total_recibida > 0,
        ROUND(NEW.subtotal_neto / v_cantidad_total_recibida, 2), 0);

    -- precioVentaSugerido = precioUnitarioNeto × (1 + margen/100)
    SET NEW.precio_venta_sugerido = ROUND(
        NEW.precio_unitario_neto * (1 + IFNULL(NEW.margen_ganancia, 20) / 100), 2);
END //

DELIMITER ;

-- ============================================================================
-- 20. TABLA: log_operaciones
-- Registro de auditoría de todas las acciones realizadas en el sistema
-- ============================================================================
CREATE TABLE log_operaciones (
    id_log          BIGINT AUTO_INCREMENT PRIMARY KEY,
    fecha           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_usuario      INT DEFAULT NULL,
    nombre_usuario  VARCHAR(150) DEFAULT NULL COMMENT 'Nombre del usuario al momento del registro',
    id_sucursal     INT DEFAULT NULL,
    nombre_sucursal VARCHAR(100) DEFAULT NULL COMMENT 'Nombre de la sucursal al momento del registro',
    accion          VARCHAR(255) NOT NULL COMMENT 'Descripción de la acción realizada',
    modulo          VARCHAR(50) DEFAULT NULL COMMENT 'Módulo del sistema (Ventas, Inventario, Compras, etc.)',
    detalle         TEXT DEFAULT NULL COMMENT 'Detalle adicional de la operación',
    ip_address      VARCHAR(45) DEFAULT NULL,

    CONSTRAINT fk_log_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT fk_log_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE SET NULL,

    INDEX idx_log_fecha (fecha),
    INDEX idx_log_usuario (id_usuario),
    INDEX idx_log_modulo (modulo)
) ENGINE=InnoDB;

-- ============================================================================
-- 22. TABLA: eliminaciones_producto
-- Solicitudes de eliminación de productos del inventario (flujo de aprobación)
-- ============================================================================
CREATE TABLE eliminaciones_producto (
    id_eliminacion  INT AUTO_INCREMENT PRIMARY KEY,
    id_producto     INT NOT NULL,
    id_inventario   INT DEFAULT NULL COMMENT 'Lote específico a eliminar',
    id_sucursal     INT DEFAULT NULL,
    motivo          TEXT NOT NULL,
    id_usuario_solicitante INT NOT NULL,
    id_usuario_admin INT DEFAULT NULL COMMENT 'Admin que aprueba/rechaza',
    estado          ENUM('Pendiente', 'Aprobada', 'Rechazada') NOT NULL DEFAULT 'Pendiente',
    fecha           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_resolucion DATETIME DEFAULT NULL,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_elimprod_producto
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_elimprod_inventario
        FOREIGN KEY (id_inventario) REFERENCES inventario(id_inventario)
        ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT fk_elimprod_sucursal
        FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
        ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT fk_elimprod_solicitante
        FOREIGN KEY (id_usuario_solicitante) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_elimprod_admin
        FOREIGN KEY (id_usuario_admin) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE SET NULL,

    INDEX idx_elimprod_estado (estado)
) ENGINE=InnoDB;

-- ============================================================================
-- 23. TABLA: desactivaciones_proveedor
-- Solicitudes de inactivación de proveedores (flujo de aprobación)
-- ============================================================================
CREATE TABLE desactivaciones_proveedor (
    id_desactivacion INT AUTO_INCREMENT PRIMARY KEY,
    id_proveedor     INT NOT NULL,
    motivo          TEXT NOT NULL,
    id_usuario_solicitante INT NOT NULL,
    id_usuario_admin INT DEFAULT NULL,
    estado          ENUM('Pendiente', 'Aprobada', 'Rechazada') NOT NULL DEFAULT 'Pendiente',
    fecha           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_resolucion DATETIME DEFAULT NULL,
    fecha_creacion  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_desactprov_proveedor
        FOREIGN KEY (id_proveedor) REFERENCES proveedores(id_proveedor)
        ON UPDATE CASCADE ON DELETE CASCADE,

    CONSTRAINT fk_desactprov_solicitante
        FOREIGN KEY (id_usuario_solicitante) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_desactprov_admin
        FOREIGN KEY (id_usuario_admin) REFERENCES usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE SET NULL,

    INDEX idx_desactprov_estado (estado)
) ENGINE=InnoDB;

-- ============================================================================
-- VISTAS ÚTILES
-- ============================================================================

-- Vista: Inventario completo con nombre de producto, categoría, sucursal
CREATE OR REPLACE VIEW v_inventario_completo AS
SELECT
    i.id_inventario,
    p.id_producto,
    p.nombre AS producto,
    c.nombre AS categoria,
    p.precio_venta,
    i.stock,
    i.stock_minimo,
    i.ubicacion,
    i.lote,
    i.fecha_vencimiento,
    i.precio_costo,
    s.nombre AS sucursal,
    s.id_sucursal,
    CASE
        WHEN i.stock <= i.stock_minimo THEN 'Bajo'
        ELSE 'Normal'
    END AS estado_stock,
    CASE
        WHEN i.fecha_vencimiento IS NOT NULL
             AND i.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'Próximo a vencer'
        ELSE 'OK'
    END AS estado_vencimiento
FROM inventario i
    INNER JOIN productos p ON i.id_producto = p.id_producto
    INNER JOIN categorias c ON p.id_categoria = c.id_categoria
    INNER JOIN sucursales s ON i.id_sucursal = s.id_sucursal
WHERE p.id_estado = 1;

-- Vista: Ventas con datos del vendedor y sucursal
CREATE OR REPLACE VIEW v_ventas_completas AS
SELECT
    v.id_venta,
    v.codigo_venta,
    v.fecha,
    v.subtotal,
    v.iva_total,
    v.total,
    v.metodo_pago,
    v.estado,
    v.pago_recibido,
    v.cambio,
    u.nombre_completo AS vendedor,
    u.id_usuario,
    s.nombre AS sucursal,
    s.id_sucursal
FROM ventas v
    INNER JOIN usuarios u ON v.id_usuario = u.id_usuario
    INNER JOIN sucursales s ON v.id_sucursal = s.id_sucursal;

-- Vista: Resumen de ventas diarias por sucursal
CREATE OR REPLACE VIEW v_ventas_diarias AS
SELECT
    DATE(v.fecha) AS fecha_dia,
    s.nombre AS sucursal,
    v.metodo_pago,
    COUNT(v.id_venta) AS total_transacciones,
    SUM(v.total) AS total_monto
FROM ventas v
    INNER JOIN sucursales s ON v.id_sucursal = s.id_sucursal
WHERE v.estado = 'Completada'
GROUP BY DATE(v.fecha), s.nombre, v.metodo_pago;

-- Vista: Productos con stock bajo
CREATE OR REPLACE VIEW v_stock_bajo AS
SELECT
    p.id_producto,
    p.nombre AS producto,
    c.nombre AS categoria,
    i.stock,
    i.stock_minimo,
    s.nombre AS sucursal,
    i.ubicacion
FROM inventario i
    INNER JOIN productos p ON i.id_producto = p.id_producto
    INNER JOIN categorias c ON p.id_categoria = c.id_categoria
    INNER JOIN sucursales s ON i.id_sucursal = s.id_sucursal
WHERE i.stock <= i.stock_minimo
  AND p.id_estado = 1;

-- Vista: Productos próximos a vencer (30 días)
CREATE OR REPLACE VIEW v_proximos_vencer AS
SELECT
    p.id_producto,
    p.nombre AS producto,
    c.nombre AS categoria,
    i.stock,
    i.lote,
    i.fecha_vencimiento,
    DATEDIFF(i.fecha_vencimiento, CURDATE()) AS dias_restantes,
    s.nombre AS sucursal
FROM inventario i
    INNER JOIN productos p ON i.id_producto = p.id_producto
    INNER JOIN categorias c ON p.id_categoria = c.id_categoria
    INNER JOIN sucursales s ON i.id_sucursal = s.id_sucursal
WHERE i.fecha_vencimiento IS NOT NULL
  AND i.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
  AND i.stock > 0
  AND p.id_estado = 1
ORDER BY i.fecha_vencimiento ASC;

-- Vista: Compras completas con nombre de proveedor
CREATE OR REPLACE VIEW v_compras_completas AS
SELECT
    co.id_compra,
    co.numero_factura,
    co.fecha,
    pr.nombre AS proveedor,
    u.nombre_completo AS comprador,
    co.metodo_pago,
    co.subtotal,
    co.iva_total,
    co.total,
    co.estado,
    s.nombre AS sucursal,
    s.id_sucursal
FROM compras co
    INNER JOIN proveedores pr ON co.id_proveedor = pr.id_proveedor
    INNER JOIN usuarios u ON co.id_usuario = u.id_usuario
    INNER JOIN sucursales s ON co.id_sucursal = s.id_sucursal;

-- Vista: Detalle de compras con campos calculados por la fórmula de precio unitario
CREATE OR REPLACE VIEW v_compra_detalle_completo AS
SELECT
    cd.id_compra_detalle,
    co.numero_factura,
    co.fecha AS fecha_compra,
    p.nombre AS producto,
    cat.nombre AS categoria,
    a.nombre AS agrupacion,
    cd.cantidad_agrupacion,
    cd.cantidad_unidades,
    cd.precio_costo,
    cd.descuento,
    cd.bonificacion,
    cd.iva_porcentaje,
    cd.iva_monto,
    cd.subtotal_neto,
    cd.precio_unitario_neto,
    cd.margen_ganancia,
    cd.precio_venta_sugerido,
    p.precio_venta AS precio_venta_actual,
    cd.lote,
    cd.fecha_entrega,
    cd.fecha_caducidad,
    pr.nombre AS proveedor,
    s.nombre AS sucursal
FROM compra_detalle cd
    INNER JOIN compras co ON cd.id_compra = co.id_compra
    INNER JOIN productos p ON cd.id_producto = p.id_producto
    INNER JOIN categorias cat ON p.id_categoria = cat.id_categoria
    LEFT JOIN agrupaciones a ON cd.id_agrupacion = a.id_agrupacion
    INNER JOIN proveedores pr ON co.id_proveedor = pr.id_proveedor
    INNER JOIN sucursales s ON co.id_sucursal = s.id_sucursal;

-- ============================================================================
-- FIN DEL SCRIPT
-- ============================================================================

SELECT '✅ Base de datos invventas_licor creada exitosamente con todas las tablas y relaciones.' AS resultado;
