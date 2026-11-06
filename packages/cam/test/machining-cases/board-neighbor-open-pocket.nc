(camNC CAM)
(board-neighbor-open-pocket)
(Plan: cam-plan-v1-5baab53238e5620e)
(Post: fluidnc. Safe Z17. Retract Z14)
(Planned bounds: X38..102 Y33..39 Z6..12)
(Stock: 140 x 120 x 12 mm)
(X0 Y0 = lower left corner of the stock, 140 x 120 mm. Z0 = stock bottom)
( Tools Table:)
(  T1 D=6 CR=0 - ZMIN=6 - synthetic flat end mill )
( )
(WARNING: Main: Pocket 1: Open-pocket path would reach a neighboring part using a path inside the pocket)
(WARNING: Main: pocket z=6: 7.7mm² left in corners/narrow spots with D=6)
G21 G90 G94 G17
G40 G49 G80
G0 Z17
(CAMNC PAUSE start; rpm=15000)
M0 (MSG Spindle starts at 15000 RPM next. Manual spindle: turn it on now)
M3 S15000
G4 P3
(OP 1/1 Main: Pocket 1 z=6 - T1 D=6)
(PASS 1/2 Z9)
X38 Y33
Z13
G1 Z12 F480
X95.243 Z9
X100.5 F1800
X102 F900
Y34.5
Y37.5 F1800
Y39 F900
X100.5
X39.5 F1800
X38 F900
Y37.5
Y34.5 F1800
Y33 F900
X39.5
X95.243 F1800
(PASS 2/2 Z6)
G0 Z14
Z13
G1 Z9 F480
X102 Z8.646
Y39 Z8.331
X57.513 Z6
X39.5 F1800
X38 F900
Y37.5
Y34.5 F1800
Y33 F900
X39.5
X100.5 F1800
X102 F900
Y34.5
Y37.5 F1800
Y39 F900
X100.5
X57.513 F1800
G0 Z17
M5
G53 G0 Z-5
(CAMNC PAUSE done)
M0 (MSG Program done. Manual spindle: off now)
M30
