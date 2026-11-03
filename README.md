# The Sea Gates

Two fleets approach a Hellenistic harbor. You have five moves before the horn sounds, six hearts at the gate, and three strips of land on which to build. Survive as many tides as you can.

[Play The Sea Gates](https://sergiubisceanu.github.io/sea-gates/)

## Your first tide

Slide the highlighted limestone one square right onto the timber. This builds a Stone Catapult on the west bank. Sound the horn and watch it fire on the first black sail. If the harbor takes no damage, each move you left unspent earns eight extra Kleos.

Tap or click two adjacent squares instead of swiping. On a keyboard, use the arrow keys to move, Enter or Space to select, and Ctrl+Z or Cmd+Z to undo a planning move. The Tide plaque opens the harbor menu. From there you can scout the fleet, read the field guide, or resume. During a battle, the horn button switches between normal and double speed.

## The machines

| Materials | Machine | Where it earns its place |
| --- | --- | --- |
| Limestone + timber | Stone Catapult | Covers a stretch of one channel. At tier III it reaches the entire channel and its shot splashes a second hull. |
| Timber + bronze | Archimedean Arm | Captures passing ships within its lift capacity. A boss can be wrenched once across all Arms, so the tier of the first Arm to reach it matters. |
| Bronze + wine | Dionysian Automaton | Slows the fleet and hastens adjacent machines. A tier III Automaton on an inner shore can reach both channels. |
| Limestone + wine | Fire Siphon | Fires an armor-piercing jet into a tight group. Place it beside the stretch where your Automaton slows an escort. |

Two adjacent machines of the same type and tier combine at the destination, up to tier III. Merging gives up a firing position, so check both channels before upgrading. Boss tides mark the approach on the board. From Tide 12, an Aegis Galley can lend armor to nearby ships in its channel. Awe or grapple the galley to interrupt its screen, or burn through the formation with a Siphon.

The Pages edition stores your current run, undo history, preferences and completed records in your browser. Reloading an interrupted battle opens it paused. Clearing the site's storage clears those records.

## Run your own copy

The playable site is already built in `docs/`. To serve that exact copy locally with Python 3, run the following command from the repository root and open [localhost:8000](http://localhost:8000/).

```sh
python3 -m http.server 8000 --directory docs
```

To edit and rebuild, use Node.js 24.13 or newer and run these commands from the repository root.

```sh
npm ci
npm run typecheck
npm run build
npm test
```

For a longer balance check, `npm run playtest:balance` plays seeded campaigns from the opening board and prints the tide each policy reaches. To publish a fork, select **Settings → Pages → Deploy from a branch**, then **main** and **/docs**. The build uses relative asset paths so it also works under a different repository name.
