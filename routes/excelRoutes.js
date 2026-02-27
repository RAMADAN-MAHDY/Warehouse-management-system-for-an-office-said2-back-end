const express = require('express');
const router = express.Router();
const InvoiceFile = require('../models/InvoiceFile');
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');

// Get all excel files for current user (JSON API)
router.get('/', protect, tenantMiddleware, async (req, res) => {
    try {
        const files = await InvoiceFile.find({ customerId: req.customerId })
            .select('-buffer') // Exclude buffer for list view to keep it light
            .sort({ createdAt: -1 });
        
        res.status(200).json({ 
            status: true, 
            message: 'Files fetched', 
            data: files 
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

// Download specific file
router.get('/:id/download', protect, tenantMiddleware, async (req, res) => {
    try {
        const file = await InvoiceFile.findOne({ 
            _id: req.params.id, 
            customerId: req.customerId 
        });

        if (!file) {
            return res.status(404).json({ status: false, message: 'File not found' });
        }

        const fileName = `report-${file.createdAt.toISOString().split('T')[0]}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        
        res.send(file.buffer);
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

// Delete file
router.delete('/:id', protect, tenantMiddleware, async (req, res) => {
    try {
        const file = await InvoiceFile.findOneAndDelete({ 
            _id: req.params.id, 
            customerId: req.customerId 
        });

        if (!file) {
            return res.status(404).json({ status: false, message: 'File not found' });
        }

        res.status(200).json({ status: true, message: 'File deleted successfully' });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
});

module.exports = router;
