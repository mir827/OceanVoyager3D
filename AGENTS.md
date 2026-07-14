# OceanVoyager3D Agent Guide

This is a browser-based Three.js adventure game built with Vite. Project-local instructions take priority over general workspace guidance.

## Core Working Rules

- Think before coding: surface material assumptions and risks.
- Keep the implementation as simple as the requested experience permits.
- Make surgical changes and avoid unrelated refactors.
- Define observable success criteria and verify them before reporting completion.
- Ask only when ambiguity would materially change the result.

## Project Conventions

- Use the existing npm scripts and installed Three.js/Vite versions.
- Keep the game client-only and do not add secrets or privileged logic.
- Preserve keyboard, touch, responsive, and reduced-motion support.
- Reuse procedural low-poly geometry before adding external 3D assets or dependencies.
- Treat loading, playing, victory, defeat, and restart as required game states.

## Verification

- Install: `npm install`
- Develop: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`
- Verify the exact affected gameplay flow in a browser and check the mobile viewport for UI changes.
