# Daily Watch release verification

Verification performed on 4 November 2026.

## Automated checks

- All 63 tests pass in the new edition: 20 engine tests, 20 account/API tests, and 23 browser-controller integration tests.
- TypeScript validation passes with `tsc --noEmit`.
- Account tests exercise the actual request handlers through a mocked platform boundary, legal replay validation, authentication, origin checks, body limits, UTC dates, account isolation, and concurrent SQLite upserts.
- Integration tests cover save recovery, duplicate rewards, stale tabs, blocked storage, date rollover, account links, guest-to-account replay transfer, offline retry, and existing-watch preservation.
- A clean public-repository candidate passes dependency installation, typecheck, build, and all 199 tests, including prior-edition regression tests. Served classic and Heliograph files remain byte-identical.

## Gameplay and balance

- 100 consecutive UTC daily seeds starting 4 November 2026 were replayed under three policies. All 300 replays validated. The idle policy won 0 watches, the material-only greedy policy won 70, and the hint policy won 100 with 36 flawless results. This is a limited deterministic balance sample, not a claim about all future seeds or human difficulty.
- A legal 152-move Voyage at seed 21 reaches Tide 50 with four hull before losing that battle. The replay is retained in `tests/voyage-50-seed-21.json`.
- The renderer harness exercised 126 battles and 14,070 events.

## Browser verification

- Played the complete seven-tide watch for 4 November 2026 through the actual browser UI. Result: victory, 8/12 hull, 2,530 score, 15 orders used.
- The Tide 7 forecast predicted four damage and the played battle matched it.
- Verified undo, pause/resume, keyboard selection, selected-machine range, collection, and the first daily reward. Reviewing the result did not add another participation day.
- Checked 320 × 568 and 390 × 844 phone layouts. Both retained the Defend control in view without horizontal overflow. The complete board was visible at 320 × 568.
- Screenshot: [Daily Watch board](Sea_Gates_Daily_Watch.jpg).

## Verification limits

These checks establish the behavior observed in this release. They do not guarantee the absence of every possible defect. Native production sign-in and an authenticated database claim require a real signed-in visitor and were not simulated in deployed code. Production deployment and live public checks are reported with the release.

GitHub guest storage and hosted-account storage have separate origins. Today's completed watch can transfer to the account edition. Earlier device-only history is not automatically migrated. Collection rewards count distinct completed current-date watches and do not increase combat power. Crowded banks may eventually exhaust useful merges during a very long Voyage.
