/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file was automatically generated by TanStack Router.
// You should NOT make any changes in this file as it will be overwritten.
// Additionally, you should also exclude this file from your linter and/or formatter to prevent it from being checked or modified.

// Import Routes

import { Route as rootRoute } from './routes/__root'
import { Route as ServeWebrtcImport } from './routes/serve-webrtc'
import { Route as ServeTrysteroImport } from './routes/serve-trystero'
import { Route as PlayTrysteroImport } from './routes/play-trystero'
import { Route as Go2webrtcImport } from './routes/go2webrtc'
import { Route as CameraCalibrationImport } from './routes/camera-calibration'
import { Route as WebrtcChannelRoomImport } from './routes/webrtc-channel.$room'
import { Route as FluidncClientRoomIdImport } from './routes/fluidnc-client.$roomId'

// Create/Update Routes

const ServeWebrtcRoute = ServeWebrtcImport.update({
  id: '/serve-webrtc',
  path: '/serve-webrtc',
  getParentRoute: () => rootRoute,
} as any)

const ServeTrysteroRoute = ServeTrysteroImport.update({
  id: '/serve-trystero',
  path: '/serve-trystero',
  getParentRoute: () => rootRoute,
} as any)

const PlayTrysteroRoute = PlayTrysteroImport.update({
  id: '/play-trystero',
  path: '/play-trystero',
  getParentRoute: () => rootRoute,
} as any)

const Go2webrtcRoute = Go2webrtcImport.update({
  id: '/go2webrtc',
  path: '/go2webrtc',
  getParentRoute: () => rootRoute,
} as any)

const CameraCalibrationRoute = CameraCalibrationImport.update({
  id: '/camera-calibration',
  path: '/camera-calibration',
  getParentRoute: () => rootRoute,
} as any)

const WebrtcChannelRoomRoute = WebrtcChannelRoomImport.update({
  id: '/webrtc-channel/$room',
  path: '/webrtc-channel/$room',
  getParentRoute: () => rootRoute,
} as any)

const FluidncClientRoomIdRoute = FluidncClientRoomIdImport.update({
  id: '/fluidnc-client/$roomId',
  path: '/fluidnc-client/$roomId',
  getParentRoute: () => rootRoute,
} as any)

// Populate the FileRoutesByPath interface

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/camera-calibration': {
      id: '/camera-calibration'
      path: '/camera-calibration'
      fullPath: '/camera-calibration'
      preLoaderRoute: typeof CameraCalibrationImport
      parentRoute: typeof rootRoute
    }
    '/go2webrtc': {
      id: '/go2webrtc'
      path: '/go2webrtc'
      fullPath: '/go2webrtc'
      preLoaderRoute: typeof Go2webrtcImport
      parentRoute: typeof rootRoute
    }
    '/play-trystero': {
      id: '/play-trystero'
      path: '/play-trystero'
      fullPath: '/play-trystero'
      preLoaderRoute: typeof PlayTrysteroImport
      parentRoute: typeof rootRoute
    }
    '/serve-trystero': {
      id: '/serve-trystero'
      path: '/serve-trystero'
      fullPath: '/serve-trystero'
      preLoaderRoute: typeof ServeTrysteroImport
      parentRoute: typeof rootRoute
    }
    '/serve-webrtc': {
      id: '/serve-webrtc'
      path: '/serve-webrtc'
      fullPath: '/serve-webrtc'
      preLoaderRoute: typeof ServeWebrtcImport
      parentRoute: typeof rootRoute
    }
    '/fluidnc-client/$roomId': {
      id: '/fluidnc-client/$roomId'
      path: '/fluidnc-client/$roomId'
      fullPath: '/fluidnc-client/$roomId'
      preLoaderRoute: typeof FluidncClientRoomIdImport
      parentRoute: typeof rootRoute
    }
    '/webrtc-channel/$room': {
      id: '/webrtc-channel/$room'
      path: '/webrtc-channel/$room'
      fullPath: '/webrtc-channel/$room'
      preLoaderRoute: typeof WebrtcChannelRoomImport
      parentRoute: typeof rootRoute
    }
  }
}

// Create and export the route tree

export interface FileRoutesByFullPath {
  '/camera-calibration': typeof CameraCalibrationRoute
  '/go2webrtc': typeof Go2webrtcRoute
  '/play-trystero': typeof PlayTrysteroRoute
  '/serve-trystero': typeof ServeTrysteroRoute
  '/serve-webrtc': typeof ServeWebrtcRoute
  '/fluidnc-client/$roomId': typeof FluidncClientRoomIdRoute
  '/webrtc-channel/$room': typeof WebrtcChannelRoomRoute
}

export interface FileRoutesByTo {
  '/camera-calibration': typeof CameraCalibrationRoute
  '/go2webrtc': typeof Go2webrtcRoute
  '/play-trystero': typeof PlayTrysteroRoute
  '/serve-trystero': typeof ServeTrysteroRoute
  '/serve-webrtc': typeof ServeWebrtcRoute
  '/fluidnc-client/$roomId': typeof FluidncClientRoomIdRoute
  '/webrtc-channel/$room': typeof WebrtcChannelRoomRoute
}

export interface FileRoutesById {
  __root__: typeof rootRoute
  '/camera-calibration': typeof CameraCalibrationRoute
  '/go2webrtc': typeof Go2webrtcRoute
  '/play-trystero': typeof PlayTrysteroRoute
  '/serve-trystero': typeof ServeTrysteroRoute
  '/serve-webrtc': typeof ServeWebrtcRoute
  '/fluidnc-client/$roomId': typeof FluidncClientRoomIdRoute
  '/webrtc-channel/$room': typeof WebrtcChannelRoomRoute
}

export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths:
    | '/camera-calibration'
    | '/go2webrtc'
    | '/play-trystero'
    | '/serve-trystero'
    | '/serve-webrtc'
    | '/fluidnc-client/$roomId'
    | '/webrtc-channel/$room'
  fileRoutesByTo: FileRoutesByTo
  to:
    | '/camera-calibration'
    | '/go2webrtc'
    | '/play-trystero'
    | '/serve-trystero'
    | '/serve-webrtc'
    | '/fluidnc-client/$roomId'
    | '/webrtc-channel/$room'
  id:
    | '__root__'
    | '/camera-calibration'
    | '/go2webrtc'
    | '/play-trystero'
    | '/serve-trystero'
    | '/serve-webrtc'
    | '/fluidnc-client/$roomId'
    | '/webrtc-channel/$room'
  fileRoutesById: FileRoutesById
}

export interface RootRouteChildren {
  CameraCalibrationRoute: typeof CameraCalibrationRoute
  Go2webrtcRoute: typeof Go2webrtcRoute
  PlayTrysteroRoute: typeof PlayTrysteroRoute
  ServeTrysteroRoute: typeof ServeTrysteroRoute
  ServeWebrtcRoute: typeof ServeWebrtcRoute
  FluidncClientRoomIdRoute: typeof FluidncClientRoomIdRoute
  WebrtcChannelRoomRoute: typeof WebrtcChannelRoomRoute
}

const rootRouteChildren: RootRouteChildren = {
  CameraCalibrationRoute: CameraCalibrationRoute,
  Go2webrtcRoute: Go2webrtcRoute,
  PlayTrysteroRoute: PlayTrysteroRoute,
  ServeTrysteroRoute: ServeTrysteroRoute,
  ServeWebrtcRoute: ServeWebrtcRoute,
  FluidncClientRoomIdRoute: FluidncClientRoomIdRoute,
  WebrtcChannelRoomRoute: WebrtcChannelRoomRoute,
}

export const routeTree = rootRoute
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()

/* ROUTE_MANIFEST_START
{
  "routes": {
    "__root__": {
      "filePath": "__root.tsx",
      "children": [
        "/camera-calibration",
        "/go2webrtc",
        "/play-trystero",
        "/serve-trystero",
        "/serve-webrtc",
        "/fluidnc-client/$roomId",
        "/webrtc-channel/$room"
      ]
    },
    "/camera-calibration": {
      "filePath": "camera-calibration.tsx"
    },
    "/go2webrtc": {
      "filePath": "go2webrtc.tsx"
    },
    "/play-trystero": {
      "filePath": "play-trystero.tsx"
    },
    "/serve-trystero": {
      "filePath": "serve-trystero.tsx"
    },
    "/serve-webrtc": {
      "filePath": "serve-webrtc.tsx"
    },
    "/fluidnc-client/$roomId": {
      "filePath": "fluidnc-client.$roomId.tsx"
    },
    "/webrtc-channel/$room": {
      "filePath": "webrtc-channel.$room.tsx"
    }
  }
}
ROUTE_MANIFEST_END */
