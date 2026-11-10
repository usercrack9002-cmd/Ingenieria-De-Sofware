const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/productos - Listar productos con categoría y agrupaciones
router.get('/', async (req, res) => {
    try {
        const [productos] = await db.query(`
            SELECT p.id_producto, p.nombre, p.precio_venta, e.nombre AS estado,
                   c.nombre AS categoria, c.id_categoria
            FROM productos p
            JOIN categorias c ON p.id_categoria = c.id_categoria
            LEFT JOIN estados e ON p.id_estado = e.id_estado
            ORDER BY p.id_producto ASC
        `);

        // Obtener agrupaciones para cada producto
        for (let prod of productos) {
            const [agrupaciones] = await db.query(`
                SELECT a.nombre AS agrupacion, a.id_agrupacion, pa.equivalencia_unidades,
                       pr.precio AS precio_agrupacion
                FROM producto_agrupaciones pa
                JOIN agrupaciones a ON pa.id_agrupacion = a.id_agrupacion
                LEFT JOIN precios_agrupacion pr ON pr.id_producto = pa.id_producto 
                       AND pr.id_agrupacion = pa.id_agrupacion AND pr.activo = 1
                WHERE pa.id_producto = ?
            `, [prod.id_producto]);

            prod.groupings = {};
            prod.groupingDetails = {};
            agrupaciones.forEach(ag => {
                prod.groupings[ag.agrupacion] = ag.equivalencia_unidades;
                prod.groupingDetails[ag.agrupacion] = {
                    id_agrupacion: ag.id_agrupacion,
                    equivalencia: ag.equivalencia_unidades,
                    precio: ag.precio_agrupacion !== null ? parseFloat(ag.precio_agrupacion) : null
                };
            });

            // Siempre incluir Unidad
            if (!prod.groupings['Unidad']) {
                prod.groupings['Unidad'] = 1;
                prod.groupingDetails['Unidad'] = {
                    id_agrupacion: 1,
                    equivalencia: 1,
                    precio: null
                };
            }
        }

        res.json(productos);
    } catch (err) {
        console.error('Error al listar productos:', err);
        res.status(500).json({ error: 'Error al obtener productos.' });
    }
});

// GET /api/productos/:id - Obtener un producto
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.id_producto, p.nombre, p.id_categoria, p.precio_venta, p.fecha_creacion, p.fecha_actualizacion,
                   e.nombre AS estado, c.nombre AS categoria
            FROM productos p
            JOIN categorias c ON p.id_categoria = c.id_categoria
            LEFT JOIN estados e ON p.id_estado = e.id_estado
            WHERE p.id_producto = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado.' });
        }

        const prod = rows[0];
        const [agrupaciones] = await db.query(`
            SELECT a.nombre AS agrupacion, a.id_agrupacion, pa.equivalencia_unidades,
                   pr.precio AS precio_agrupacion
            FROM producto_agrupaciones pa
            JOIN agrupaciones a ON pa.id_agrupacion = a.id_agrupacion
            LEFT JOIN precios_agrupacion pr ON pr.id_producto = pa.id_producto 
                   AND pr.id_agrupacion = pa.id_agrupacion AND pr.activo = 1
            WHERE pa.id_producto = ?
        `, [prod.id_producto]);

        prod.groupings = {};
        prod.groupingDetails = {};
        agrupaciones.forEach(ag => {
            prod.groupings[ag.agrupacion] = ag.equivalencia_unidades;
            prod.groupingDetails[ag.agrupacion] = {
                id_agrupacion: ag.id_agrupacion,
                equivalencia: ag.equivalencia_unidades,
                precio: ag.precio_agrupacion !== null ? parseFloat(ag.precio_agrupacion) : null
            };
        });

        // Siempre incluir Unidad
        if (!prod.groupings['Unidad']) {
            prod.groupings['Unidad'] = 1;
            prod.groupingDetails['Unidad'] = {
                id_agrupacion: 1,
                equivalencia: 1,
                precio: null
            };
        }

        res.json(prod);
    } catch (err) {
        console.error('Error al obtener producto:', err);
        res.status(500).json({ error: 'Error al obtener producto.' });
    }
});

// POST /api/productos - Crear producto
router.post('/', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { nombre, id_categoria, precio_venta, groupings } = req.body;
        if (!nombre || !id_categoria || precio_venta === undefined) {
            return res.status(400).json({ error: 'Campos obligatorios faltantes.' });
        }

        const [result] = await conn.query(`
            INSERT INTO productos (nombre, id_categoria, precio_venta)
            VALUES (?, ?, ?)
        `, [nombre, id_categoria, precio_venta]);

        const productId = result.insertId;

        // Insertar agrupaciones
        if (groupings && typeof groupings === 'object') {
            for (const [groupName, equiv] of Object.entries(groupings)) {
                const [agrupRows] = await conn.query(
                    'SELECT id_agrupacion FROM agrupaciones WHERE nombre = ?', [groupName]
                );
                if (agrupRows.length > 0) {
                    await conn.query(`
                        INSERT INTO producto_agrupaciones (id_producto, id_agrupacion, equivalencia_unidades)
                        VALUES (?, ?, ?)
                    `, [productId, agrupRows[0].id_agrupacion, equiv]);
                }
            }
        }

        // Inicializar registros de inventario (Bodega y Mostrador) con stock 0 para todas las sucursales activas
        const [sucursales] = await conn.query("SELECT id_sucursal FROM sucursales WHERE id_estado = 1");
        for (const suc of sucursales) {
            await conn.query(`
                INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo)
                VALUES (?, ?, 'Bodega', 0, 5, 0.00)
            `, [productId, suc.id_sucursal]);
            await conn.query(`
                INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo)
                VALUES (?, ?, 'Mostrador', 0, 5, 0.00)
            `, [productId, suc.id_sucursal]);
        }

        await conn.commit();
        res.status(201).json({ id_producto: productId, message: 'Producto creado exitosamente.' });
    } catch (err) {
        await conn.rollback();
        console.error('Error al crear producto:', err);
        res.status(500).json({ error: 'Error al crear producto.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

// PUT /api/productos/:id - Modificar producto
router.put('/:id', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { nombre, id_categoria, precio_venta, groupings } = req.body;
        const productId = req.params.id;

        await conn.query(`
            UPDATE productos SET nombre = ?, id_categoria = ?, precio_venta = ?
            WHERE id_producto = ?
        `, [nombre, id_categoria, precio_venta, productId]);

        // Reemplazar agrupaciones
        if (groupings && typeof groupings === 'object') {
            await conn.query('DELETE FROM producto_agrupaciones WHERE id_producto = ?', [productId]);
            for (const [groupName, equiv] of Object.entries(groupings)) {
                const [agrupRows] = await conn.query(
                    'SELECT id_agrupacion FROM agrupaciones WHERE nombre = ?', [groupName]
                );
                if (agrupRows.length > 0) {
                    await conn.query(`
                        INSERT INTO producto_agrupaciones (id_producto, id_agrupacion, equivalencia_unidades)
                        VALUES (?, ?, ?)
                    `, [productId, agrupRows[0].id_agrupacion, equiv]);
                }
            }
        }

        await conn.commit();
        res.json({ message: 'Producto actualizado exitosamente.' });
    } catch (err) {
        await conn.rollback();
        console.error('Error al actualizar producto:', err);
        res.status(500).json({ error: 'Error al actualizar producto.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

// PATCH /api/productos/:id/estado - Activar/Desactivar producto
router.patch('/:id/estado', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id_estado, nombre FROM productos WHERE id_producto = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado.' });

        const nuevoEstadoId = rows[0].id_estado === 1 ? 2 : 1;
        await db.query('UPDATE productos SET id_estado = ? WHERE id_producto = ?', [nuevoEstadoId, req.params.id]);
        const nuevoEstadoText = nuevoEstadoId === 1 ? 'Activo' : 'Inactivo';

        res.json({ message: `Producto ${nuevoEstadoText.toLowerCase()}.`, estado: nuevoEstadoText, nombre: rows[0].nombre });
    } catch (err) {
        console.error('Error al cambiar estado producto:', err);
        res.status(500).json({ error: 'Error al cambiar estado.' });
    }
});

// GET /api/productos/agrupaciones/lista - Listar agrupaciones disponibles
router.get('/agrupaciones/lista', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM agrupaciones ORDER BY id_agrupacion');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener agrupaciones.' });
    }
});

// GET /api/productos/precios-agrupacion/lista-todos - Obtener todos los precios por agrupación configurados
router.get('/precios-agrupacion/lista-todos', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT pa.*, p.nombre AS producto_nombre, a.nombre AS agrupacion_nombre
            FROM precios_agrupacion pa
            JOIN productos p ON pa.id_producto = p.id_producto
            JOIN agrupaciones a ON pa.id_agrupacion = a.id_agrupacion
            WHERE pa.activo = 1
            ORDER BY p.nombre ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error al obtener todos los precios agrupados:', err);
        res.status(500).json({ error: 'Error al obtener todos los precios agrupados.' });
    }
});

// GET /api/productos/:id/precios-agrupacion - Precios por agrupación
router.get('/:id/precios-agrupacion', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT pa.*, a.nombre AS agrupacion
            FROM precios_agrupacion pa
            JOIN agrupaciones a ON pa.id_agrupacion = a.id_agrupacion
            WHERE pa.id_producto = ? AND pa.activo = 1
        `, [req.params.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener precios.' });
    }
});

// POST /api/productos/:id/precios-agrupacion - Guardar precio agrupación
router.post('/:id/precios-agrupacion', async (req, res) => {
    try {
        const { id_agrupacion, precio, descuento_porcentaje } = req.body;
        await db.query(`
            INSERT INTO precios_agrupacion (id_producto, id_agrupacion, precio, descuento_porcentaje)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE precio = VALUES(precio), descuento_porcentaje = VALUES(descuento_porcentaje), activo = 1
        `, [req.params.id, id_agrupacion, precio, descuento_porcentaje || 0]);

        res.json({ message: 'Precio de agrupación guardado.' });
    } catch (err) {
        console.error('Error al guardar precio agrupación:', err);
        res.status(500).json({ error: 'Error al guardar precio.' });
    }
});

module.exports = router;
