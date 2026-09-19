# QA driver synchronization observation

The first flow stopped at "Live strip names the later order stop while reading cart history".
A direct browser snapshot immediately afterward showed "Checkout demo — paused at Order creation",
selected "Cart mutation", cartCount 0 and disabled Continue, with the new rendered acknowledgment.
The fixture shares item/title/revision for these two states. Its former wait accepted the previous
rendered message before the queued postMessage updated the live strip. No product defect was established.
The driver now waits for a new rendered acknowledgment after each publish, then asserts the visible state.
Product files were not changed. Preserve driver-history-observation.png and the initial failed run.

The next pass reached the generic control loop, then the driver selected the hidden
Overview copy of the source action while Live was active. Playwright reported
"element is not visible". The loop now chooses the visible source control.
This changes only the test selector; no product code or tested outcome changed.
