%
(Fusion CAM 2703.1.11)
( Posts processor: MPCNC.cps)
( Gcode generated: Tue Nov  3 09:28:16 2026 GMT)
( Document: kinderregal v4)
( Setup: back)
(When using Fusion for Personal Use, the feedrate of rapid)
(moves is reduced to match the feedrate of cutting moves,)
(which can increase machining time. Unrestricted rapid moves)
(are available with a Fusion Subscription.)
( )
( Ranges Table:)
(   X: Min=-2.64 Max=401.688 Size=404.328)
(   Y: Min=-1.688 Max=381.688 Size=383.375)
(   Z: Min=-0.3 Max=11 Size=11.3)
( )
( Tools Table:)
(  T1 D=3.175 CR=0 - ZMIN=-0.3 - flat end mill )
( )
( Feedrate and Scaling Properties:)
(   Feed: Travel speed X/Y = 9000)
(   Feed: Travel Speed Z = 1200)
(   Feed: Enforce Feedrate = true)
(   Feed: Scale Feedrate = true)
(   Feed: Max XY Cut Speed = 6000)
(   Feed: Max Z Cut Speed = 1200)
(   Feed: Max Toolpath Speed = 6000)
( )
( G1->G0 Mapping Properties:)
(   Map: First G1 -> G0 Rapid = true)
(   Map: G1s -> G0 Rapids = true)
(   Map: SafeZ Mode = Feed : default = 2)
(   Map: Allow Rapid Z = true)
( )
( *** START begin ***)
( --- Start custom gcode /Users/manu/development/cnc/gcode/start.gcode)
G21
G90
G94
;G10 L20 P0 X0 Y0
;M0 (MSG Attach probe)
;G38.2 Z-100 F200 P5.0 (probe down set thickness )
;G1 Z10 F900
;M0 (MSG Remove probe)(undefined)
( *** START end ***)
( )
( *** SECTION begin ***)
(   X Min: -2.64 - X Max: 401.688)
(   Y Min: -1.688 - Y Max: 381.688)
(   Z Min: 1 - Z Max: 11)
( SafeZ feed level: 5)
( 2D Contour1 5 - Milling - Tool: 1 -  flat end mill)
( COMMAND_START_SPINDLE)
( COMMAND_SPINDLE_CLOCKWISE)
( >>> Spindle Speed: Manual)
M0 (MSG Turn ON 15000RPM)
( COMMAND_COOLANT_ON)
( MOVEMENT_CUTTING)
( First G1 --> G0)
G0 Z11 F1200
X-2.64 Y189.682 F9000
( Safe G1 --> G0)
Z5 F1200
( MOVEMENT_PLUNGE)
G1 Z3.635 F480
Z1.317 F480
( MOVEMENT_LEAD_IN)
G18 G2 X-2.322 Z1 I0.318 F1800
G1 X-2.005 F1800
G17 G3 X-1.688 Y190 J0.318 F1800
( MOVEMENT_FINISH_CUTTING)
G1 Y380 F1800
G2 X0 Y381.688 I1.687 F1800
G1 X400 F1800
G2 X401.688 Y380 J-1.688 F1800
G1 Y0 F1800
G2 X400 Y-1.688 I-1.688 F1800
G1 X0 F1800
G2 X-1.688 Y0 J1.688 F1800
G1 Y190 F1800
( MOVEMENT_LEAD_OUT)
G3 X-2.005 Y190.318 I-0.318 F1800
G1 X-2.322 F1800
G18 G3 X-2.64 Z1.317 K0.317 F1800
( MOVEMENT_CUTTING)
( Safe G1 --> G0)
G0 Z11 F1200
( *** SECTION end ***)
()
(When using Fusion for Personal Use, the feedrate of rapid)
(moves is reduced to match the feedrate of cutting moves,)
(which can increase machining time. Unrestricted rapid moves)
(are available with a Fusion Subscription.)
( *** SECTION begin ***)
(   X Min: -2.54 - X Max: 401.587)
(   Y Min: -1.587 - Y Max: 381.587)
(   Z Min: -0.3 - Z Max: 11)
( SafeZ feed level: 5)
( 2D Contour2 5 - Milling - Tool: 1 -  flat end mill)
( COMMAND_START_SPINDLE)
( COMMAND_SPINDLE_CLOCKWISE)
( COMMAND_COOLANT_ON)
( First G1 --> G0)
Z11 F1200
X-2.54 Y189.682 F9000
( Safe G1 --> G0)
Z5 F1200
( MOVEMENT_PLUNGE)
G1 Z3.635 F480
Z0.017 F480
( MOVEMENT_LEAD_IN)
G2 X-2.223 Z-0.3 I0.317 F1800
G1 X-1.905 F1800
G17 G3 X-1.587 Y190 J0.318 F1800
( MOVEMENT_FINISH_CUTTING)
G1 Y380 F1800
G2 X0 Y381.587 I1.587 F1800
G1 X400 F1800
G2 X401.587 Y380 J-1.587 F1800
G1 Y0 F1800
G2 X400 Y-1.587 I-1.587 F1800
G1 X0 F1800
G2 X-1.587 Y0 J1.587 F1800
G1 Y190 F1800
( MOVEMENT_LEAD_OUT)
G3 X-1.905 Y190.318 I-0.317 F1800
G1 X-2.223 F1800
G18 G3 X-2.54 Z0.017 K0.318 F1800
( MOVEMENT_CUTTING)
( Safe G1 --> G0)
G0 Z11 F1200
( *** SECTION end ***)
()
( *** STOP begin ***)
( --- Start custom gcode /Users/manu/development/cnc/gcode/end.gcode)
G0 G53 Z0 F900
G0 X0 Y0 F9000(undefined)
%
