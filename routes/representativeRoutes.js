const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validateMiddleware');
const { checkSubscription } = require('../middleware/subscriptionMiddleware');
const {
    listRepresentatives,
    getRepresentative,
    createRepresentative,
    updateRepresentative,
    deleteRepresentative
} = require('../controllers/representativeController');
const { representativeCreateSchema, representativeUpdateSchema } = require('../validations/representativeValidation');

router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', listRepresentatives);
router.get('/:id', getRepresentative);
router.post('/', authorize('admin', 'editor'), validate(representativeCreateSchema), createRepresentative);
router.put('/:id', authorize('admin', 'editor'), validate(representativeUpdateSchema), updateRepresentative);
router.delete('/:id', authorize('admin'), deleteRepresentative);

module.exports = router;

