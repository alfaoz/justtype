const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_YOUR_KEY_HERE') {
  console.warn('⚠ STRIPE_SECRET_KEY not configured - Stripe integration disabled');
  module.exports = null;
} else {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  // Helper function to ensure products and prices exist
  async function ensureStripeProducts() {
    try {
      // Check if products already exist
      const products = await stripe.products.list({ limit: 10 });

      let oneTimeProduct = products.data.find(p => p.metadata.type === 'one_time');
      let quarterlyProduct = products.data.find(p => p.metadata.type === 'quarterly');

      // Create one-time product if it doesn't exist
      if (!oneTimeProduct) {
        oneTimeProduct = await stripe.products.create({
          name: 'justtype supporter',
          description: '50 MB storage + supporter badge',
          metadata: { type: 'one_time' }
        });
        console.log('✓ Created Stripe one-time product:', oneTimeProduct.id);
      }

      // Create quarterly product if it doesn't exist
      if (!quarterlyProduct) {
        quarterlyProduct = await stripe.products.create({
          name: 'justtype <3 supporter',
          description: 'unlimited storage + <3 supporter badge',
          metadata: { type: 'quarterly' }
        });
        console.log('✓ Created Stripe quarterly product:', quarterlyProduct.id);

        // Create price for quarterly subscription
        const quarterlyPrice = await stripe.prices.create({
          product: quarterlyProduct.id,
          unit_amount: 700, // 7 EUR in cents
          currency: 'eur',
          recurring: {
            interval: 'month',
            interval_count: 3 // Every 3 months
          },
          metadata: { type: 'quarterly' }
        });
        console.log('✓ Created Stripe quarterly price:', quarterlyPrice.id);
      }

      // Get the price IDs
      const prices = await stripe.prices.list({ limit: 10 });
      const quarterlyPrice = prices.data.find(p => p.metadata.type === 'quarterly');

      return {
        oneTimeProductId: oneTimeProduct.id,
        quarterlyPriceId: quarterlyPrice?.id
      };
    } catch (error) {
      console.error('Error ensuring Stripe products:', error);
      return null;
    }
  }

  module.exports = {
    stripe,
    ensureStripeProducts
  };
}
