# Library tutorial

The library tutorial builds a small [application](glossary.md#application) step by step, from a generated skeleton to a checked desk screen. Each step is a prompt for a coding agent, such as Claude Code or Codex, and names the skill the agent follows. The application is the technical library of a power transformer plant. Librarians lend standards, manuals and engineering books to employees, and the desk has a webcam on the librarian's PC instead of a barcode scanner.

## Setup

The first step runs in the framework repository and exports a new repository with `scaffold new`. Every later step runs at the root of that export. `bun install` in the export links the skills into `.claude/skills/` for Claude Code and `.agents/skills/` for Codex, and the agent reads the export's `AGENTS.md`.

1. Install Bun 1.4.4 and the Playwright browsers with `bunx playwright install chromium`.
2. Start the coding agent at the root of the framework repository for the first step, and at the root of the export for the others.
3. Paste the step's prompt.
4. Review the diff and commit it before the next step, so each step can be reset on its own.

`scaffold add` runs from the export root. Its policy rules, descriptions and tests name the generated `editor` role. The library keeps the generated role names: editors are the librarians, and viewers read.

In a source export, `bun run check:skills` reports paths into omitted examples and patterns and a root script removed from the export. The steps use these checks instead, from the export root:

```sh
bun run format
bun run generate
bun run typecheck
bun test showcase/examples/plant-library
```

A step that changes screens also runs these:

```sh
bun run build
bunx playwright test showcase/examples/plant-library
```

The screen steps run in Chromium with a fake camera. The Playwright specs launch it with `--use-fake-ui-for-media-stream` and `--use-fake-device-for-media-stream`, which grant camera access and show a generated test pattern.

## Application export

Skill: `create-agent-native-app`. The step exports the framework, the starter and a generated application in `showcase/examples/plant-library` with one `book` collection, default list and record screens, and the site, network, audit and compliance plugins.

```text
Use the create-agent-native-app skill. Create the application for the technical library of a
power transformer plant at /path/to/plant-library, with the name plant-library, the display name
"Plant Library" and the first collection book. Librarians lend standards, manuals and engineering
books to employees at a desk that has a webcam and no barcode scanner. One build serves the
library for 180 days.

Export it with scaffold new and initialize Git in the new directory. Install it, run the checks
the scaffold prints, and commit the result. Then start it with bun run dev:web in
showcase/examples/plant-library, and from the new repository's root create one book through the
CLI, list the books through the CLI and through the MCP bridge, and stop the instance. Report each
command and what it printed. Run the checks the create-agent-native-app skill names and report
what passed.
```

The agent reports a passing test run, the book it created and the same book in both lists.

## Books and loans

Skill: `add-capability`. The step replaces the generated book record, adds a `loan` collection, and adds the check-out and check-in commands that alone write loans, each with the hand-over photo as a blob.

```text
Use the add-capability skill. In showcase/examples/plant-library, replace the generated book
record with the library's book record. Keep id, createdBy and createdAt.

- title: such as "IEC 60076-1 Power transformers, Part 1: General".
- edition: such as "Edition 3.1, 2011".
- kind: standard, manual or book.
- shelfMark: the label on the spine, such as "TR 621.314 IEC".
- isbn: optional, 13 digits.
- status: available or out. A new book is available.

book.create takes title, edition, kind, shelfMark and isbn, and refuses a duplicate shelf mark.
book.update changes title, edition, kind and isbn. The title is the record's title. book.list
searches title, shelf mark and ISBN, and filters by status and kind. book.get and book.list
return each book's revision. Keep the role names: editors are the librarians and write, viewers
read. The workspace holds only trial records, so delete showcase/examples/plant-library/.workspace
instead of writing a state migration.

Then run from the repository root:

bun run scaffold add collection loan
bun run scaffold add capability book.check-out --kind command --description "Lend an available book to an employee until a due date, with the desk photo of the hand-over. Librarians only."
bun run scaffold add capability book.check-in --kind command --description "Take a lent book back, with the desk photo of the hand-over. Librarians only."

A loan records bookId, the book's title and shelfMark, borrower (an employee number, E followed
by six digits), borrowerName, dueOn (a date), checkedOutBy, checkedOutAt and checkOutPhoto, and
on check-in returnedAt, returnedBy and returnPhoto. A photo is a blob reference: a JPEG or PNG of
at most 5 MiB that the screen uploads to the blob store before the command. Remove the generated
loan create and update commands, so only the two book commands write loans; members read loans.

book.check-out takes bookId, borrower, borrowerName, dueOn and photo. It refuses a book that is
out with CONFLICT and a due date before today with INVALID_INPUT, and creates the open loan and
sets the book to out in the same transaction. book.check-in takes bookId and photo, refuses a
book that is not out with CONFLICT, closes the book's open loan and sets the book to available.
loan.list filters by state (open or returned) and by overdue (open and due before today), searches
title, shelf mark and borrower, and lists open loans by due date. Filter the rows before paging
and counting.

Write behavioral tests with a fixed clock for a viewer refused, a stale book revision refused, a
repeated idempotency key returning the same receipt, a second check-out refused, a check-in of an
available book refused, a photo of another media type refused, and the overdue filter. Update the
generated tests, the Playwright spec and the application README. Run the checks the
add-capability skill names and report what passed.
```

## Desk screen

Skills: `build-screens` and `add-scanner-input`. The step adds the screen the librarian works on: a webcam viewfinder with a shutter, the book search and the check-out and check-in forms.

The framework's camera input source, `createCameraSource` in `packages/devices`, decodes barcodes in the live video through the browser's `BarcodeDetector` or an injected decoder. It bundles no decoder and reads no printed text. The desk therefore reads the ISBN barcode where the browser provides the detector, and otherwise the librarian picks the book from a title search next to the picture.

```text
Use the build-screens skill and the add-scanner-input skill. In showcase/examples/plant-library,
add the Desk screen, where a librarian lends and takes back books in front of the webcam on the
desk PC. Make it the home screen and the first navigation item, with a Camera icon.

Camera and picture:

- Declare the webcam as a required camera device in the module's requirements, so the security
  manifest lists it. Open it only after the librarian presses Start camera.
- When createCameraSource from @agent-native/devices reports isSupported, start it on the
  viewfinder's video element with a profile that reads EAN-13, so it reads the ISBN barcode while
  the book is held up. Otherwise open the camera with getUserMedia into the same video element.
- The shutter draws the current frame to a canvas and keeps it as a JPEG of at most 1280 pixels
  on the long side. Show pictures as data URLs, because the content security policy refuses
  blob: images. Retake drops the picture and returns to the live view.
- Upload the picture with transport.blobs.put only when the librarian confirms, and pass the
  reference as photo to book.check-out or book.check-in.

Identifying the book:

- A barcode read searches book.list by the ISBN and selects the single match.
- Otherwise the librarian types part of the title or shelf mark next to the picture and picks the
  book from the five best matches of book.list. The picture stays the record of the hand-over.
- Share the selected book with agent runs through the UI session.

Layout and style, from the starter's shadcn components and Tailwind tokens only:

- The page is max-w-7xl with p-6, a text-2xl font-semibold tracking-tight title "Desk" and one
  text-sm text-muted-foreground line under it. Below, a grid with
  lg:grid-cols-[minmax(0,1.6fr)_minmax(22rem,1fr)] and gap-6; one column below lg.
- Left, a Card holding the viewfinder: aspect-video, rounded-xl, overflow-hidden, bg-zinc-950,
  the video object-cover. Over it, a centered portrait capture frame (aspect-[3/4], h-4/5) with
  primary corner brackets and the area outside dimmed by
  shadow-[0_0_0_9999px_rgb(0_0_0/0.45)], and a text-xs text-white/80 caption "Hold the cover or
  the barcode inside the frame". A live dot (bg-success) and "Live" sit top left.
- Under the viewfinder, one row: Retake as an outline button with a RotateCcw icon on the left,
  a round shutter in the middle (size-16 rounded-full, border-4 border-background, ring-2
  ring-primary, aria-label "Take picture"), the capture time in text-xs tabular-nums on the
  right. Under it, a thumbnail strip of this session's pictures, h-14 w-20 rounded-md
  object-cover, with ring-2 ring-primary on the one used for the hand-over.
- The viewfinder area shows these states instead of the video: camera off (Camera icon, "Camera
  is off", a primary Start camera button); access refused, on NotAllowedError (CameraOff icon in
  text-destructive, "Camera access was refused", one line on allowing it in the browser's site
  settings, Try again); no camera, on NotFoundError or no mediaDevices ("No camera found",
  "Connect a webcam to this PC and try again").
- Right, two stacked Cards with gap-4. The Book card has an input group with a Search icon,
  labelled "Find book", placeholder "Title, shelf mark or ISBN", and the matches as full-width
  buttons (rounded-lg border p-3, hover:bg-accent, the selected one border-primary
  bg-primary/5): title text-sm font-medium line-clamp-2, edition and shelf mark in font-mono
  text-xs text-muted-foreground, and the status badge. The selected book shows its title in
  text-lg font-semibold leading-tight, the edition, the shelf mark in a font-mono pill
  (rounded-md bg-muted px-2 py-0.5) and the status badge, with "Read from barcode" and a
  ScanBarcode icon when the camera source found it.
- The action Card: for an available book, Employee number (font-mono, E and six digits),
  Borrower name, Due date (a date input, default four weeks ahead, with ghost buttons for 2, 4
  and 8 weeks) and a full-width large primary Check out button. For a book that is out, the
  open loan's borrower and due date in relative words, and a full-width large Check in button.
  The action button stays disabled until a picture is taken, with the text-xs line "Take a
  picture first". After a commit, show a success Alert ("Lent to Anna Keller until 24 Nov 2026"
  or "Returned") and clear the selection and the picture. Show command errors in a destructive
  Alert in the card.
- Put the status badge in ui/status.tsx for the later screens: available in success
  (bg-success/10 text-success border-success/30), out in primary (bg-primary/10 text-primary),
  overdue in destructive (bg-destructive/10 text-destructive).
- Use only tokens such as bg-card, border and text-muted-foreground, apart from the viewfinder's
  black, so the screen works in light and dark.

Bind book.check-out and book.check-in to the screen and keep the UI-binding test passing. Extend
the Playwright spec, launching Chromium with --use-fake-ui-for-media-stream and
--use-fake-device-for-media-stream: create a book, start the camera, take a picture, find the
book by title, check it out, see it out, take a picture, check it in and see it available. Add a
test that rejects getUserMedia with NotAllowedError and sees the refused state. Save screenshots
of the desk with a picture and a selected book in light and dark (emulateMedia colorScheme) to
docs-screenshots/desk-light.png and docs-screenshots/desk-dark.png at 1440 by 1000, look at them
and fix what looks unfinished. Run the checks the build-screens skill names and report what
passed.
```

## Loans screen

Skill: `build-screens`. The step adds the loans table with tabs for books out, overdue and returned, the hand-over photos and due dates in relative words.

```text
Use the build-screens skill. In showcase/examples/plant-library, replace the loans list with the
Loans screen at /loans, second in the navigation after Desk with a BookMarked icon, and keep Books
third.

- The page is max-w-7xl with p-6, a text-2xl font-semibold tracking-tight title "Loans" and a
  text-sm text-muted-foreground line with the live counts, such as "12 out, 3 overdue", from
  loan.list totals.
- Under it, one row with Tabs on the left (Out, Overdue, Returned, each with its count in a small
  secondary Badge) and a search input group on the right (Search icon, placeholder "Title, shelf
  mark or borrower", w-72). Each tab reads loan.list with its filter: Out is state open, Overdue
  is overdue, Returned is state returned. Search and page on the server, 25 rows a page, with
  Previous and Next outline buttons and "1-25 of 40" in text-xs text-muted-foreground. Never
  filter or page in the browser.
- The rows sit in a Card with the shadcn Table, sticky header in text-xs font-medium
  text-muted-foreground, rows h-16. Columns:
  - Photo: the check-out photo from /api/v1/blobs/<digest>, h-10 w-14 rounded-md object-cover
    with a ring-1 ring-border. A click opens a native dialog with the check-out photo and, for a
    returned loan, the check-in photo side by side, each with its date.
  - Book: the title in text-sm font-medium, the shelf mark under it in font-mono text-xs
    text-muted-foreground.
  - Borrower: the name, and the employee number under it in font-mono text-xs.
  - Due: the date in tabular-nums and, under it, relative words from Intl.RelativeTimeFormat
    ("in 5 days", "due today", "3 days overdue").
  - Status: the status badge from ui/status.tsx, Out or Overdue; a returned loan shows a muted
    Returned badge and its return date.
- An overdue row has bg-destructive/5, a border-l-2 border-l-destructive on its first cell, and
  its due words in text-destructive font-medium.
- Empty states inside the Card, centered with an icon in a size-10 rounded-full bg-muted circle:
  Out "No books are out"; Overdue, with a CheckCircle2 icon in text-success, "Nothing is overdue";
  Returned "No returns yet"; a search with no rows "No loans match". A failed read shows a
  destructive Alert with a Retry button.
- A row's book title links to the Desk with that book selected.
- Use only tokens, so the screen works in light and dark.

Extend the Playwright spec: check a book out at the Desk, see it on the Out tab with its photo
thumbnail and its due words, open the photo dialog, check it in, and see it on the Returned tab.
Save screenshots of the Out tab in light and dark to docs-screenshots/loans-light.png and
docs-screenshots/loans-dark.png at 1440 by 1000, look at them and fix what looks unfinished. Run
the checks the build-screens skill names and report what passed.
```

## Final checks

Skill: `check-a-change`. The step runs the checks for every change since the export and separates browser evidence from what did not run.

```text
Use the check-a-change skill. In the plant-library repository, choose the checks for every change
since the application export and run them from the repository root. Read the generated security
manifest in dist/reference/ and confirm it lists the desk camera and no network destination.
Update the application README's tests and limits for the Desk and Loans screens. Report unit,
browser and by-hand evidence separately. Name what ran only against Chromium's fake camera or a
stubbed BarcodeDetector, and what did not run at all, such as a real webcam and a printed ISBN
barcode. Run the checks the check-a-change skill names and report what passed.
```

## Limits

- No step ran a real webcam. The Playwright specs use Chromium's fake camera, and the barcode test stubs `BarcodeDetector`.
- Chromium provides `BarcodeDetector` on macOS, ChromeOS and Android. Firefox, Safari and Chromium on Windows and Linux have none, so the desk offers only the title search there.
- `createCameraSource` takes no video constraints, so it opens the webcam at the browser's default resolution.
- The camera source reads barcodes, not printed text. A book without an ISBN barcode is found by title or shelf mark.
- The desktop shell refuses every permission request in `apps/desktop/src/main.ts`, so the desk runs in a browser on the desk PC.
- `book.check-out` refuses a due date before today, so a browser run cannot create an overdue loan. The behavioral tests cover overdue loans with a fixed clock.
- These skills have no step, because the library needs no system of record, workstation sign-in, assignment or site bundle: `connect-system-of-record`, `sign-in-at-a-terminal`, `assign-work`, `write-a-feature` and `deploy-to-site`.

## References

- [Tutorial](tutorial.md)
- [Getting started](getting-started.md#new-application)
- [create-agent-native-app](../packages/scaffold/skills/create-agent-native-app/SKILL.md)
- [add-capability](../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../packages/frame/skills/build-screens/SKILL.md)
- [add-scanner-input](../packages/devices/skills/add-scanner-input/SKILL.md)
- [check-a-change](../packages/testing/skills/check-a-change/SKILL.md)
- [Point-of-work input](point-of-work-input.md)
- [Capability authoring](capability-authoring.md)
