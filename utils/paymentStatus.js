const computePaymentStatus = (totalAmount, paidAmount) => {
  const total = Number(totalAmount);
  const paid = Number(paidAmount || 0);
  
  if (paid >= total) {
    return 'paid';
  } else if (paid > 0) {
    return 'partial';
  } else {
    return 'unpaid';
  }
};

module.exports = { computePaymentStatus };
