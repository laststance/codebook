# Captured cart stop

Snapshot: 7588ae39-c89b-4a74-8607-d8b08066c4b9:1

The click reached addToCart in cart.ts:9. At this stop, selectedProduct.id is tote-01, its price is 24, and state.items.length is 0. The next statement adds the selected product. The cart mutation and its visible update have not executed yet. Continuing this pause lets that statement run.

These statements describe this captured frame only. No checkout, backend request, or other path was observed.
