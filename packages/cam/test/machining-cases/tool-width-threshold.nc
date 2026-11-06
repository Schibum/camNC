(camNC CAM)
(tool-width-threshold)
(Plan: cam-plan-v1-02c12fb6dd1e614a)
(Post: fluidnc. Safe Z9. Retract Z6)
(Planned bounds: X4.588..25.413 Y17.588..17.637 Z2.5..4)
(Stock: 30 x 24 x 4 mm)
(X0 Y0 = lower left corner of the stock, 30 x 24 mm. Z0 = stock bottom)
( Tools Table:)
(  T1 D=3.175 CR=0 - ZMIN=2.5 - synthetic flat end mill )
( )
(WARNING: pocket z=2.5: 170.0mm² left in corners/narrow spots with D=3.175)
G21 G90 G94 G17
G40 G49 G80
G0 Z9
(CAMNC PAUSE start; rpm=15000)
M0 (MSG Spindle starts at 15000 RPM next. Manual spindle: turn it on now)
M3 S15000
G4 P3
(OP 1/1 Pocket 1 z=2.5 - T1 D=3.175)
(PASS 1/1 Z2.5)
X4.588 Y17.588
Z5
G1 Z4 F480
X25.413 Z2.909 F360
Y17.637 Z2.906
X17.666 Z2.5
X6.088 F1800
X6.038 F720
X4.588
Y17.588
X6.038
X6.088
X23.913 F1800
X23.962 F720
X25.413
Y17.637
X23.962
X23.913
X17.666 F1800
G0 Z9
M5
G53 G0 Z-5
(CAMNC PAUSE done)
M0 (MSG Program done. Manual spindle: off now)
M30
