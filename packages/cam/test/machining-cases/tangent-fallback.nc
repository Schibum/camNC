(camNC CAM)
(tangent-fallback)
(Plan: cam-plan-v1-bd9cad7fbccdb2b3)
(Post: fluidnc. Safe Z8. Retract Z5)
(Planned bounds: X6.979..7.021 Y6.979..7.021 Z-0.3..2.34)
(Stock: 14 x 14 x 3 mm)
(X0 Y0 = lower left corner of the stock, 14 x 14 mm. Z0 = stock bottom)
( Tools Table:)
(  T1 D=3.175 CR=0 - ZMIN=-0.3 - synthetic flat end mill )
( )
(WARNING: Tangent entry does not fit the cutter-centre region using a contour ramp)
(WARNING: Contour entry loop is too small for a ramp using a bounded plunge)
G21 G90 G94 G17
G40 G49 G80
G0 Z8
(CAMNC PAUSE start; rpm=15000)
M0 (MSG Spindle starts at 15000 RPM next. Manual spindle: turn it on now)
M3 S15000
G4 P3
(OP 1/1 Small hole - T1 D=3.175)
(PASS 1/9 Z2.34)
X7.007 Y6.981
Z4
G1 Z2.34 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F720
G1 X7.007 Y6.981
(PASS 2/9 Z1.68)
G0 Z5
Z4
G1 Z1.68 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F720
G1 X7.007 Y6.981
(PASS 3/9 Z1.02)
G0 Z5
Z4
G1 Z1.02 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F720
G1 X7.007 Y6.981
(PASS 4/9 Z0.36)
G0 Z5
Z4
G1 Z0.36 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F720
G1 X7.007 Y6.981
(PASS 5/9 Z2.34)
G0 Z5
Z4
G1 Z2.34 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F360
G1 X7.007 Y6.981
(PASS 6/9 Z1.68)
G0 Z5
Z4
G1 Z1.68 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F360
G1 X7.007 Y6.981
(PASS 7/9 Z1.02)
G0 Z5
Z4
G1 Z1.02 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F360
G1 X7.007 Y6.981
(PASS 8/9 Z0.36)
G0 Z5
Z4
G1 Z0.36 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F360
G1 X7.007 Y6.981
(PASS 9/9 Z-0.3)
G0 Z5
Z4
G1 Z-0.3 F480
G3 X7.005 Y6.98 I-0.008 J0.019 F360
G1 X7.007 Y6.981
G0 Z8
M5
G53 G0 Z-5
(CAMNC PAUSE done)
M0 (MSG Program done. Manual spindle: off now)
M30
