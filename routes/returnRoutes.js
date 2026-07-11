const express = require('express');
const router = express.Router();
const { addReturn, getReturns, deleteReturn } = require('../controllers/returnController');
const authorize = require('../middleware/authorize');

router.post('/', authorize('admin', 'editor'), addReturn);
router.get('/', getReturns);
router.delete('/:id', authorize('admin'), deleteReturn);

module.exports = router;
