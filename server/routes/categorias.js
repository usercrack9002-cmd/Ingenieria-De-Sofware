const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/categorias
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM categorias ORDER BY id_categoria ASC');
        res.json(rows);
    } catch (err) {
        console.error('Error al listar categorías:', err);
        res.status(500).json({ error: 'Error al obtener categorías.' });
    }
});

// POST /api/categorias
router.post('/', async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
        }

        const [existing] = await db.query('SELECT id_categoria FROM categorias WHERE nombre = ?', [nombre.trim()]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'La categoría ya existe.' });
        }

        const [result] = await db.query('INSERT INTO categorias (nombre) VALUES (?)', [nombre.trim()]);
        res.status(201).json({ id_categoria: result.insertId, message: 'Categoría creada exitosamente.' });
    } catch (err) {
        console.error('Error al crear categoría:', err);
        res.status(500).json({ error: 'Error al crear categoría.' });
    }
});

// PUT /api/categorias/:id
router.put('/:id', async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
        }

        // Verificar duplicados
        const [existing] = await db.query(
            'SELECT id_categoria FROM categorias WHERE nombre = ? AND id_categoria != ?',
            [nombre.trim(), req.params.id]
        );
        if (existing.length > 0) {
            return res.status(409).json({ error: 'Ya existe una categoría con ese nombre.' });
        }

        await db.query('UPDATE categorias SET nombre = ? WHERE id_categoria = ?', [nombre.trim(), req.params.id]);
        res.json({ message: 'Categoría actualizada exitosamente.' });
    } catch (err) {
        console.error('Error al actualizar categoría:', err);
        res.status(500).json({ error: 'Error al actualizar categoría.' });
    }
});

// DELETE /api/categorias/:id
router.delete('/:id', async (req, res) => {
    try {
        // Verificar si hay productos con esta categoría
        const [products] = await db.query('SELECT COUNT(*) AS total FROM productos WHERE id_categoria = ?', [req.params.id]);
        if (products[0].total > 0) {
            return res.status(409).json({ error: 'No se puede eliminar una categoría que tiene productos asignados.' });
        }

        await db.query('DELETE FROM categorias WHERE id_categoria = ?', [req.params.id]);
        res.json({ message: 'Categoría eliminada exitosamente.' });
    } catch (err) {
        console.error('Error al eliminar categoría:', err);
        res.status(500).json({ error: 'Error al eliminar categoría.' });
    }
});

module.exports = router;
