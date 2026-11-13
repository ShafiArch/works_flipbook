page-flip.js is StPageFlip 2.0.7 (MIT, see page-flip-LICENSE.txt), the browser build from npm.
One local change: destroy() also removes the window resize listener, so rebuilding the book
(rotating a phone, switching 1 page / 2 pages) does not leave old copies listening.
