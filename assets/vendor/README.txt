page-flip.js is StPageFlip 2.0.7 (MIT, see page-flip-LICENSE.txt), the browser build from npm.
Local changes:
- the cover and a lone last page stay soft paper (the original makes them stiff "hard" pages,
  which turn like a card); a page can still be made stiff with data-density="hard".
- destroy() also removes the window resize listener, so rebuilding the book
  (rotating a phone, switching 1 page / 2 pages) does not leave old copies listening.
