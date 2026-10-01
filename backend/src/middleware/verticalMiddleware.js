/**
 * verticalMiddleware — opens the per-request vertical context.
 *
 * Mounted as the FIRST middleware, before any route. It starts an
 * AsyncLocalStorage store for the whole request with its verticals still
 * unset, and `authMiddleware.protect()` fills them in once the JWT has been
 * resolved to a real user.
 *
 * ── WHY THE STORE OPENS EMPTY INSTEAD OF DEFAULTING TO cg ────────────
 * It has to be opened here, at the top, because AsyncLocalStorage can only
 * wrap a callback — once routing has begun it is too late to put a store
 * underneath it. But WHO the user is isn't known until `protect()` runs.
 *
 * An unset store means "no filter", which is the right answer for the
 * unauthenticated routes it covers (login, health). The moment a route
 * authenticates, `protect()` sets the real value. A route that reads client
 * data without authenticating would be unscoped — so it must not exist, and
 * `test_vertical_isolation.js` is what proves none does.
 */
const { runWithPendingVerticals } = require('../config/verticals');

const openVerticalContext = (req, res, next) => runWithPendingVerticals(() => next());

module.exports = { openVerticalContext };
