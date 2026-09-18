# Captured cart stop

Snapshot: 47ebcbfc-6d1d-4d1d-8a66-217b7e582585:1

The click reached addToCart in cart.ts:9. At this stop, selectedProduct.id is tote-01, its price is 24, and state.items.length is 0. The next statement adds the selected product. The cart mutation and its visible update have not executed yet. Continuing this pause lets that statement run.

These statements describe this captured frame only. No checkout, backend request, or other path was observed.
