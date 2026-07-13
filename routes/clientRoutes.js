const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validateMiddleware');
const { checkSubscription } = require('../middleware/subscriptionMiddleware');
const {
    listClients,
    getClient,
    createClient,
    updateClient,
    deleteClient
} = require('../controllers/clientController');
const { clientCreateSchema, clientUpdateSchema } = require('../validations/clientValidation');

router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', listClients);
router.get('/:id', getClient);
router.post('/', authorize('admin', 'editor'), validate(clientCreateSchema), createClient);
router.put('/:id', authorize('admin', 'editor'), validate(clientUpdateSchema), updateClient);
router.delete('/:id', authorize('admin'), deleteClient);

module.exports = router;
