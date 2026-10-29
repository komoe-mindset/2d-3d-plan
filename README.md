# Sample Home Design: A House on One Line

An architectural 2D-to-3D interactive experience built in React, TypeScript, Three.js, GSAP ScrollTrigger, and Lenis.

## Features

- **2D-to-3D Architectural Transition**: Begins on a flat floor plan sheet (black ink on paper, room names, dimension strings, title block, and floor joints). As the user scrolls, walls rise out of the drawing, the camera tilts down, and transitions seamlessly into the 3D space.
- **Dynamic Cut Clipping Plane**: Synchronizes the clipping plane from the +1.20 m architectural plan cut up to full height.
- **Physical Material Sweep**: As the camera reaches the entrance hall, real materials (honed limestone, rift-cut oak, lime plaster, leather, bronze, and contact shadows) sweep across the room while surrounding rooms remain as ink drawings.
- **Interactive Navigation Rail**: Jump directly between checkpoints (`01 Sheet`, `02 Lift`, `03 Forecourt`, `04 Hall`) with smooth momentum-driven scrolling.
- **Live HUD**: Displays real-time optical lens focal angle (`fov`), camera elevation, and cut plane status.
- **Responsive Architecture**: Adapts camera rig, sheet frame, and typographic scale dynamically across desktop and mobile aspect ratios.

## Tech Stack

- React 18 + TypeScript + Vite
- Three.js (r170)
- GSAP + ScrollTrigger
- Lenis smooth scrolling
- Tailwind CSS
