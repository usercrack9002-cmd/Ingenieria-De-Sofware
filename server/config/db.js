const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Cargar variables desde server/.env (si existe) sin dependencias externas
(function cargarEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const linea of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = linea.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || process.env[match[1]] !== undefined) continue;
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
})();

// ============================================================================
// CONFIGURACIÓN DE CONEXIÓN A MySQL
// Modifica estos valores según tu instalación de MySQL Workbench
// ============================================================================
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'nodeuser',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'invventas_licor',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
};

// Crear el pool para consultas generales de las rutas
const pool = mysql.createPool(DB_CONFIG);

/**
 * Inicializa la base de datos:
 * 1. Conecta temporalmente a MySQL sin base de datos
 * 2. Crea la base de datos si no existe
 * 3. Ejecuta el script SQL si no hay tablas creadas
 * 4. Semilla el usuario administrador 'carmelo' si no existe
 */
async function initDatabase() {
    console.log('🔄 Inicializando base de datos...');
    let tempConn;
    try {
        // Conectar temporalmente sin seleccionar base de datos para comprobar/crearla
        tempConn = await mysql.createConnection({
            host: DB_CONFIG.host,
            port: DB_CONFIG.port,
            user: DB_CONFIG.user,
            password: DB_CONFIG.password
        });

        // Crear base de datos si no existe
        await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await tempConn.query(`USE \`${DB_CONFIG.database}\``);

        // Verificar si existen tablas
        const [tables] = await tempConn.query('SHOW TABLES');
        if (tables.length === 0) {
            console.log('⚡ Base de datos vacía. Importando esquema SQL...');
            const sqlPath = path.join(__dirname, '..', '..', 'database', 'invventas_licor_db.sql');
            if (fs.existsSync(sqlPath)) {
                await executeSqlFile(tempConn, sqlPath);
                console.log('✅ Esquema SQL importado exitosamente.');
            } else {
                console.warn(`⚠️ Archivo SQL no encontrado en ${sqlPath}. No se pudo inicializar las tablas.`);
            }

            // Crear usuario Carmelo inicial con bcrypt
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('admin', 10);

            const [users] = await tempConn.query('SELECT id_usuario FROM usuarios WHERE usuario = ?', ['carmelo']);
            if (users.length === 0) {
                await tempConn.query(`
                    INSERT INTO usuarios (nombre_completo, usuario, contrasena, id_rol, id_sucursal)
                    VALUES (?, ?, ?, ?, NULL)
                `, ['Carmelo', 'carmelo', hashedPassword, 1]); // id_rol = 1 (Gerente)
                console.log('✅ Usuario administrador inicial (carmelo / admin) creado exitosamente.');
            }
        } else {
            console.log('✨ Base de datos ya configurada con tablas existentes.');

            // --- INICIO MIGRACIÓN TABLA ESTADOS ---
            try {
                const [columnCheck] = await tempConn.query("SHOW COLUMNS FROM usuarios LIKE 'id_estado'");
                if (columnCheck.length === 0) {
                    console.log('🔄 Ejecutando migración para normalizar estados a través de una tabla...');
                    
                    // 1. Crear tabla estados
                    await tempConn.query(`
                        CREATE TABLE IF NOT EXISTS estados (
                            id_estado INT AUTO_INCREMENT PRIMARY KEY,
                            nombre VARCHAR(50) NOT NULL UNIQUE
                        ) ENGINE=InnoDB
                    `);
                    
                    // 2. Poblar tabla estados
                    await tempConn.query(`
                        INSERT IGNORE INTO estados (id_estado, nombre) VALUES (1, 'Activo'), (2, 'Inactivo')
                    `);

                    // 3. Eliminar vistas dependientes temporalmente
                    await tempConn.query("DROP VIEW IF EXISTS v_inventario_completo");
                    await tempConn.query("DROP VIEW IF EXISTS v_stock_bajo");
                    await tempConn.query("DROP VIEW IF EXISTS v_proximos_vencer");

                    // 4. Migrar sucursales
                    await tempConn.query("ALTER TABLE sucursales ADD COLUMN id_estado INT NOT NULL DEFAULT 1");
                    await tempConn.query("UPDATE sucursales SET id_estado = CASE WHEN estado = 'Inactiva' THEN 2 ELSE 1 END");
                    await tempConn.query("ALTER TABLE sucursales DROP COLUMN estado");
                    await tempConn.query(`
                        ALTER TABLE sucursales 
                        ADD CONSTRAINT fk_sucursal_estado 
                        FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
                        ON UPDATE CASCADE ON DELETE RESTRICT
                    `);

                    // 5. Migrar usuarios
                    await tempConn.query("ALTER TABLE usuarios ADD COLUMN id_estado INT NOT NULL DEFAULT 1");
                    await tempConn.query("UPDATE usuarios SET id_estado = CASE WHEN estado = 'Inactivo' THEN 2 ELSE 1 END");
                    await tempConn.query("ALTER TABLE usuarios DROP COLUMN estado");
                    await tempConn.query(`
                        ALTER TABLE usuarios 
                        ADD CONSTRAINT fk_usuario_estado 
                        FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
                        ON UPDATE CASCADE ON DELETE RESTRICT
                    `);

                    // 6. Migrar productos
                    await tempConn.query("ALTER TABLE productos ADD COLUMN id_estado INT NOT NULL DEFAULT 1");
                    await tempConn.query("UPDATE productos SET id_estado = CASE WHEN estado = 'Inactivo' THEN 2 ELSE 1 END");
                    await tempConn.query("ALTER TABLE productos DROP COLUMN estado");
                    await tempConn.query(`
                        ALTER TABLE productos 
                        ADD CONSTRAINT fk_producto_estado 
                        FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
                        ON UPDATE CASCADE ON DELETE RESTRICT
                    `);

                    // 7. Migrar proveedores
                    await tempConn.query("ALTER TABLE proveedores ADD COLUMN id_estado INT NOT NULL DEFAULT 1");
                    await tempConn.query("UPDATE proveedores SET id_estado = CASE WHEN estado = 'Inactivo' THEN 2 ELSE 1 END");
                    await tempConn.query("ALTER TABLE proveedores DROP COLUMN estado");
                    await tempConn.query(`
                        ALTER TABLE proveedores 
                        ADD CONSTRAINT fk_proveedor_estado 
                        FOREIGN KEY (id_estado) REFERENCES estados(id_estado)
                        ON UPDATE CASCADE ON DELETE RESTRICT
                    `);

                    // 8. Recrear vistas
                    await tempConn.query(`
                        CREATE VIEW v_inventario_completo AS
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
                            CASE WHEN i.stock <= i.stock_minimo THEN 'Bajo' ELSE 'Normal' END AS estado_stock,
                            CASE WHEN i.fecha_vencimiento IS NOT NULL AND i.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'Próximo a vencer' ELSE 'OK' END AS estado_vencimiento
                        FROM inventario i
                            INNER JOIN productos p ON i.id_producto = p.id_producto
                            INNER JOIN categorias c ON p.id_categoria = c.id_categoria
                            INNER JOIN sucursales s ON i.id_sucursal = s.id_sucursal
                        WHERE p.id_estado = 1
                    `);

                    await tempConn.query(`
                        CREATE VIEW v_stock_bajo AS
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
                        WHERE i.stock <= i.stock_minimo AND p.id_estado = 1
                    `);

                    await tempConn.query(`
                        CREATE VIEW v_proximos_vencer AS
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
                        WHERE i.fecha_vencimiento IS NOT NULL AND i.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND i.stock > 0 AND p.id_estado = 1
                        ORDER BY i.fecha_vencimiento ASC
                    `);
                    console.log('✅ Migración de estados completada exitosamente.');
                }
            } catch (migracionEstErr) {
                console.error('⚠️ Error al aplicar migración de tabla de estados:', migracionEstErr.message);
            }
            // --- FIN MIGRACIÓN TABLA ESTADOS ---

            // Asegurar que el usuario carmelo exista
            const [users] = await tempConn.query('SELECT id_usuario FROM usuarios WHERE usuario = ?', ['carmelo']);
            if (users.length === 0) {
                const bcrypt = require('bcryptjs');
                const hashedPassword = await bcrypt.hash('admin', 10);
                await tempConn.query(`
                    INSERT INTO usuarios (nombre_completo, usuario, contrasena, id_rol, id_sucursal)
                    VALUES (?, ?, ?, ?, NULL)
                `, ['Carmelo', 'carmelo', hashedPassword, 1]);
                console.log('✅ Usuario administrador inicial (carmelo / admin) creado exitosamente.');
            }
        }

        // --- INICIO MIGRACIÓN CONTRASEÑAS SHA2 A BCRYPT ---
        try {
            const [usersToMigrate] = await tempConn.query("SELECT id_usuario, contrasena FROM usuarios");
            const bcrypt = require('bcryptjs');
            let hashAdmin123 = null;
            let hashVendedor123 = null;
            let hashAdmin = null;

            for (const u of usersToMigrate) {
                if (u.contrasena === '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9') {
                    if (!hashAdmin123) hashAdmin123 = await bcrypt.hash('admin123', 10);
                    await tempConn.query("UPDATE usuarios SET contrasena = ? WHERE id_usuario = ?", [hashAdmin123, u.id_usuario]);
                    console.log(`🔑 Migrada contraseña SHA2 a bcrypt para usuario ID ${u.id_usuario} (admin123)`);
                } else if (u.contrasena === '56976bf24998ca63e35fe4f1e2469b5751d1856003e8d16fef0aafef496ed044') {
                    if (!hashVendedor123) hashVendedor123 = await bcrypt.hash('vendedor123', 10);
                    await tempConn.query("UPDATE usuarios SET contrasena = ? WHERE id_usuario = ?", [hashVendedor123, u.id_usuario]);
                    console.log(`🔑 Migrada contraseña SHA2 a bcrypt para usuario ID ${u.id_usuario} (vendedor123)`);
                } else if (u.contrasena === '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918') {
                    if (!hashAdmin) hashAdmin = await bcrypt.hash('admin', 10);
                    await tempConn.query("UPDATE usuarios SET contrasena = ? WHERE id_usuario = ?", [hashAdmin, u.id_usuario]);
                    console.log(`🔑 Migrada contraseña SHA2 a bcrypt para usuario ID ${u.id_usuario} (admin)`);
                } else if (u.contrasena && u.contrasena.length === 64) {
                    if (!hashAdmin123) hashAdmin123 = await bcrypt.hash('admin123', 10);
                    await tempConn.query("UPDATE usuarios SET contrasena = ? WHERE id_usuario = ?", [hashAdmin123, u.id_usuario]);
                    console.log(`🔑 Reseteada contraseña SHA2 desconocida a bcrypt (admin123) para usuario ID ${u.id_usuario}`);
                }
            }
        } catch (passwdMigrErr) {
            console.error('⚠️ Error al migrar contraseñas de SHA2 a bcrypt:', passwdMigrErr.message);
        }
        // --- FIN MIGRACIÓN CONTRASEÑAS SHA2 A BCRYPT ---

        // Ejecutar migraciones adicionales para soportar anulación de compras
        try {
            const [columns] = await tempConn.query("SHOW COLUMNS FROM anulaciones LIKE 'id_compra'");
            if (columns.length === 0) {
                console.log('🔄 Ejecutando migración de base de datos para anulaciones...');
                await tempConn.query("ALTER TABLE anulaciones MODIFY id_venta INT NULL");
                await tempConn.query("ALTER TABLE anulaciones ADD COLUMN id_compra INT NULL");
                await tempConn.query(`
                    ALTER TABLE anulaciones 
                    ADD CONSTRAINT fk_anulacion_compra 
                    FOREIGN KEY (id_compra) REFERENCES compras(id_compra) 
                    ON UPDATE CASCADE ON DELETE SET NULL
                `);
                console.log('✅ Migración de anulaciones ejecutada con éxito.');
            }
        } catch (migrationErr) {
            console.error('⚠️ Error al aplicar migración de anulaciones:', migrationErr.message);
        }

        // Asegurar que exista la tabla sesiones
        try {
            console.log('🔄 Verificando/Creando tabla sesiones...');
            await tempConn.query(`
                CREATE TABLE IF NOT EXISTS sesiones (
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
                ) ENGINE=InnoDB
            `);
            console.log('✅ Tabla sesiones lista.');
        } catch (sesionErr) {
            console.error('⚠️ Error al asegurar tabla sesiones:', sesionErr.message);
        }

        // Asegurar que exista la tabla desactivaciones_proveedor
        try {
            console.log('🔄 Verificando/Creando tabla desactivaciones_proveedor...');
            await tempConn.query(`
                CREATE TABLE IF NOT EXISTS desactivaciones_proveedor (
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
                ) ENGINE=InnoDB
            `);
            console.log('✅ Tabla desactivaciones_proveedor lista.');
        } catch (desactErr) {
            console.error('⚠️ Error al asegurar tabla desactivaciones_proveedor:', desactErr.message);
        }

        // --- INICIO MIGRACIÓN SESIÓN DE ARQUEOS (CIERRE DE CAJA POR USUARIO) ---
        try {
            const [arqueoColumnCheck] = await tempConn.query("SHOW COLUMNS FROM ventas LIKE 'id_arqueo'");
            if (arqueoColumnCheck.length === 0) {
                console.log('🔄 Ejecutando migración para asociar ventas/gastos a sesiones de arqueo...');

                // 1. Modificar ENUM de arqueos_caja
                await tempConn.query("ALTER TABLE arqueos_caja MODIFY COLUMN estado ENUM('Abierto', 'Cuadrada', 'Faltante', 'Sobrante', 'Sin Conteo') NOT NULL DEFAULT 'Abierto'");

                // 2. Agregar columna id_arqueo a ventas
                await tempConn.query("ALTER TABLE ventas ADD COLUMN id_arqueo INT NULL");
                await tempConn.query(`
                    ALTER TABLE ventas 
                    ADD CONSTRAINT fk_venta_arqueo 
                    FOREIGN KEY (id_arqueo) REFERENCES arqueos_caja(id_arqueo)
                    ON UPDATE CASCADE ON DELETE SET NULL
                `);

                // 3. Agregar columna id_arqueo a gastos
                await tempConn.query("ALTER TABLE gastos ADD COLUMN id_arqueo INT NULL");
                await tempConn.query(`
                    ALTER TABLE gastos 
                    ADD CONSTRAINT fk_gasto_arqueo 
                    FOREIGN KEY (id_arqueo) REFERENCES arqueos_caja(id_arqueo)
                    ON UPDATE CASCADE ON DELETE SET NULL
                `);

                console.log('✅ Migración de sesiones de arqueo completada.');
            }
        } catch (arqueoMigrCheckErr) {
            console.error('⚠️ Error al aplicar migración de sesiones de arqueo:', arqueoMigrCheckErr.message);
        }
        // --- INICIO MIGRACIÓN PROVEEDORES POR SUCURSAL ---
        try {
            // 1. Quitar tiempo_entrega si existe
            const [columnCheckTiempo] = await tempConn.query("SHOW COLUMNS FROM proveedores LIKE 'tiempo_entrega'");
            if (columnCheckTiempo.length > 0) {
                console.log('🔄 Removiendo columna tiempo_entrega de proveedores...');
                await tempConn.query("ALTER TABLE proveedores DROP COLUMN tiempo_entrega");
                console.log('✅ Columna tiempo_entrega removida.');
            }

            // 2. Agregar id_sucursal si no existe
            const [columnCheckSucursal] = await tempConn.query("SHOW COLUMNS FROM proveedores LIKE 'id_sucursal'");
            if (columnCheckSucursal.length === 0) {
                console.log('🔄 Agregando columna id_sucursal a proveedores...');
                await tempConn.query("ALTER TABLE proveedores ADD COLUMN id_sucursal INT NOT NULL DEFAULT 1");
                await tempConn.query(`
                    ALTER TABLE proveedores 
                    ADD CONSTRAINT fk_proveedor_sucursal 
                    FOREIGN KEY (id_sucursal) REFERENCES sucursales(id_sucursal)
                    ON UPDATE CASCADE ON DELETE RESTRICT
                `);
                console.log('✅ Columna id_sucursal y clave foránea fk_proveedor_sucursal agregadas a proveedores.');
            }
        } catch (provMigrErr) {
            console.error('⚠️ Error al aplicar migración de proveedores por sucursal:', provMigrErr.message);
        }
        // --- FIN MIGRACIÓN PROVEEDORES POR SUCURSAL ---
        
        // Asegurar registros de inventario iniciales (Bodega y Mostrador) con stock 0 para todos los productos en todas las sucursales
        try {
            console.log('🔄 Sincronizando registros de inventario iniciales (Bodega/Mostrador) para todos los productos...');
            await tempConn.query(`
                INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo)
                SELECT p.id_producto, s.id_sucursal, 'Bodega', 0, 5, 0.00
                FROM productos p
                CROSS JOIN sucursales s
                LEFT JOIN inventario i ON i.id_producto = p.id_producto AND i.id_sucursal = s.id_sucursal AND i.ubicacion = 'Bodega'
                WHERE s.id_estado = 1 AND i.id_inventario IS NULL
            `);
            await tempConn.query(`
                INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo)
                SELECT p.id_producto, s.id_sucursal, 'Mostrador', 0, 5, 0.00
                FROM productos p
                CROSS JOIN sucursales s
                LEFT JOIN inventario i ON i.id_producto = p.id_producto AND i.id_sucursal = s.id_sucursal AND i.ubicacion = 'Mostrador'
                WHERE s.id_estado = 1 AND i.id_inventario IS NULL
            `);
            console.log('✅ Sincronización de registros de inventario completada.');
        } catch (invSyncErr) {
            console.error('⚠️ Error al sincronizar registros de inventario iniciales:', invSyncErr.message);
        }

        console.log('✅ Base de datos inicializada correctamente.');
    } catch (err) {
        console.error('');
        console.error('❌ ERROR de base de datos durante la inicialización:');
        console.error('   Mensaje:', err.message);
        console.error('');
        console.error('   SOLUCIÓN:');
        console.error('   1. Asegúrate de que MySQL está corriendo (MySQL Workbench > Server Status).');
        console.error('   2. Configura la contraseña correcta en server/config/db.js o usa un archivo .env.');
        console.error('   3. Si estás ejecutando en Windows, puedes iniciar el backend estableciendo la contraseña:');
        console.error('      set DB_PASSWORD=tu_contraseña && npm start');
        console.error('');
        throw err;
    } finally {
        if (tempConn) {
            await tempConn.end();
        }
    }
}

/**
 * Lee y ejecuta un archivo SQL por sentencias, respetando DELIMITER de los triggers
 */
async function executeSqlFile(connection, filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    // Quitar comentarios de bloque
    const cleanContent = content.replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = cleanContent.split(/\r?\n/);

    let commands = [];
    let currentCommand = '';
    let inDelimiter = ';';

    for (let line of lines) {
        let trimmedLine = line.trim();
        // Ignorar líneas vacías y comentarios simples
        if (trimmedLine === '' || trimmedLine.startsWith('--') || trimmedLine.startsWith('#')) {
            continue;
        }

        // Cambio de delimitador
        if (trimmedLine.toUpperCase().startsWith('DELIMITER')) {
            const parts = trimmedLine.split(/\s+/);
            if (parts.length > 1) {
                inDelimiter = parts[1];
            }
            continue;
        }

        currentCommand += line + '\n';

        if (trimmedLine.endsWith(inDelimiter)) {
            let cmdToExecute = currentCommand.trim();
            if (cmdToExecute.endsWith(inDelimiter)) {
                cmdToExecute = cmdToExecute.substring(0, cmdToExecute.length - inDelimiter.length).trim();
            }
            if (cmdToExecute) {
                commands.push(cmdToExecute);
            }
            currentCommand = '';
        }
    }

    for (let cmd of commands) {
        try {
            await connection.query(cmd);
        } catch (queryErr) {
            if (queryErr.code === 'ER_BINLOG_CREATE_ROUTINE_NEED_SUPER' && cmd.toUpperCase().includes('TRIGGER')) {
                console.warn(`⚠️ Advertencia: No se pudo crear el trigger por falta de privilegios SUPER (binary logging). Se omitirá.`);
            } else {
                throw queryErr;
            }
        }
    }
}

module.exports = pool;
module.exports.initDatabase = initDatabase;
