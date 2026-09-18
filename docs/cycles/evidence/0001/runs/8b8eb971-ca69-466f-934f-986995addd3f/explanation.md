# Captured cart stop

Snapshot: a63c6d79-455b-42cc-a289-770b8c0455c0:1

The click reached addToCart in cart.ts:9. At this stop, selectedProduct.id is tote-01, its price is 24, and state.items.length is 0. The next statement adds the selected product. The cart mutation and its visible update have not executed yet. Continuing this pause lets that statement run.

These statements describe this captured frame only. No checkout, backend request, or other path was observed.
