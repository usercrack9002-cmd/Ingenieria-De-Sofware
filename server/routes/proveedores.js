const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/proveedores
router.get('/', async (req, res) => {
    try {
        const sucursal = req.query.sucursal || (req.session && req.session.user ? req.session.user.sucursal : null);
        let query = `
            SELECT p.id_proveedor, p.nombre, p.contacto, p.telefono, p.correo, e.nombre AS estado,
                   s.nombre AS sucursal, p.id_sucursal
            FROM proveedores p
            LEFT JOIN estados e ON p.id_estado = e.id_estado
            LEFT JOIN sucursales s ON p.id_sucursal = s.id_sucursal
        `;
        const params = [];
        if (sucursal && sucursal !== 'todas' && sucursal !== 'Todas') {
            query += ' WHERE s.nombre = ?';
            params.push(sucursal);
        }
        query += ' ORDER BY p.id_proveedor ASC';

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error al listar proveedores:', err);
        res.status(500).json({ error: 'Error al obtener proveedores.' });
    }
});

// POST /api/proveedores
router.post('/', async (req, res) => {
    try {
        const { nombre, contacto, telefono, correo, id_sucursal, estado } = req.body;
        if (!nombre || !contacto || !telefono || !correo || !id_sucursal) {
            return res.status(400).json({ error: 'Campos obligatorios faltantes.' });
        }

        // Validaciones
        if (/\d/.test(nombre)) {
            return res.status(400).json({ error: 'El nombre del proveedor no debe contener números.' });
        }
        if (/\d/.test(contacto)) {
            return res.status(400).json({ error: 'El contacto del proveedor no debe contener números.' });
        }
        if (!/^\d{8}$/.test(telefono)) {
            return res.status(400).json({ error: 'El teléfono debe tener exactamente 8 números.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
            return res.status(400).json({ error: 'El correo electrónico no es válido.' });
        }

        // Validar nombre único
        const [existing] = await db.query('SELECT id_proveedor FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))', [nombre]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Ya existe un proveedor registrado con ese nombre.' });
        }

        const id_estado = (estado === 'Inactivo') ? 2 : 1;

        const [result] = await db.query(`
            INSERT INTO proveedores (nombre, contacto, telefono, correo, id_sucursal, id_estado)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [nombre, contacto, telefono, correo, id_sucursal, id_estado]);

        res.status(201).json({ id_proveedor: result.insertId, message: 'Proveedor agregado exitosamente.' });
    } catch (err) {
        console.error('Error al crear proveedor:', err);
        res.status(500).json({ error: 'Error al crear proveedor.' });
    }
});

// PUT /api/proveedores/:id
router.put('/:id', async (req, res) => {
    try {
        const { nombre, contacto, telefono, correo, id_sucursal, estado } = req.body;
        const id_estado = (estado === 'Inactivo') ? 2 : 1;

        // Validaciones si se proporcionan
        if (nombre && /\d/.test(nombre)) {
            return res.status(400).json({ error: 'El nombre del proveedor no debe contener números.' });
        }
        if (contacto && /\d/.test(contacto)) {
            return res.status(400).json({ error: 'El contacto del proveedor no debe contener números.' });
        }
        if (telefono && !/^\d{8}$/.test(telefono)) {
            return res.status(400).json({ error: 'El teléfono debe tener exactamente 8 números.' });
        }
        if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
            return res.status(400).json({ error: 'El correo electrónico no es válido.' });
        }

        // Validar nombre único excluyendo al proveedor actual
        if (nombre) {
            const [existing] = await db.query(
                'SELECT id_proveedor FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND id_proveedor != ?',
                [nombre, req.params.id]
            );
            if (existing.length > 0) {
                return res.status(409).json({ error: 'Ya existe un proveedor registrado con ese nombre.' });
            }
        }

        const [existingProv] = await db.query('SELECT id_sucursal FROM proveedores WHERE id_proveedor = ?', [req.params.id]);
        const final_sucursal = id_sucursal !== undefined ? id_sucursal : (existingProv[0]?.id_sucursal || 1);

        await db.query(`
            UPDATE proveedores
            SET nombre = ?, contacto = ?, telefono = ?, correo = ?, id_sucursal = ?, id_estado = ?
            WHERE id_proveedor = ?
        `, [nombre, contacto, telefono, correo, final_sucursal, id_estado, req.params.id]);

        res.json({ message: 'Proveedor actualizado exitosamente.' });
    } catch (err) {
        console.error('Error al actualizar proveedor:', err);
        res.status(500).json({ error: 'Error al actualizar proveedor.' });
    }
});

// DELETE /api/proveedores/:id
router.delete('/:id', async (req, res) => {
    try {
        const [compras] = await db.query('SELECT COUNT(*) AS total FROM compras WHERE id_proveedor = ?', [req.params.id]);
        if (compras[0].total > 0) {
            return res.status(409).json({ error: 'No se puede eliminar un proveedor que tiene compras registradas.' });
        }

        await db.query('DELETE FROM proveedores WHERE id_proveedor = ?', [req.params.id]);
        res.json({ message: 'Proveedor eliminado exitosamente.' });
    } catch (err) {
        console.error('Error al eliminar proveedor:', err);
        res.status(500).json({ error: 'Error al eliminar proveedor.' });
    }
});

module.exports = router;
