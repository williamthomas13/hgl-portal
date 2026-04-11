import { loadStripe } from '@stripe/stripe-js'

// This ensures Stripe is only loaded once, keeping your app lightning fast
export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
)