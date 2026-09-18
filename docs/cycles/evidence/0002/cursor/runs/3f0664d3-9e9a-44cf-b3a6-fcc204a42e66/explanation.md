# Captured cart stop

Snapshot: 725f4a93-fe9d-4e53-9039-7ea4bc9e9e25:1

The click reached addToCart in cart.ts:9. At this stop, selectedProduct.id is tote-01, its price is 24, and state.items.length is 0. The next statement adds the selected product. The cart mutation and its visible update have not executed yet. Continuing this pause lets that statement run.

These statements describe this captured frame only. No checkout, backend request, or other path was observed.
