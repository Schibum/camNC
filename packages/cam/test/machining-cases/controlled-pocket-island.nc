(camNC CAM)
(controlled-pocket-island)
(Plan: cam-plan-v1-d920a53d5d654249)
(Post: fluidnc. Safe Z10. Retract Z7)
(Planned bounds: X3.588..10.412 Y3.588..7.913 Z3.5..5)
(Stock: 14 x 12 x 5 mm)
(X0 Y0 = lower left corner of the stock, 14 x 12 mm. Z0 = stock bottom)
( Tools Table:)
(  T1 D=3.175 CR=0 - ZMIN=3.5 - synthetic flat end mill )
( )
(WARNING: pocket z=3.5: 21.8mm² left in corners/narrow spots with D=3.175)
(WARNING: 2 roughing loops left for cleanup because the requested turn radius does not fit)
(WARNING: 1 controlled pocket entry locations require full-width entry ramp feed and stepdown remain separate limits)
(WARNING: Planar material-rate limits exclude axial removal in 40 descending moves ramp/plunge feed and stepdown apply separat)
G21 G90 G94 G17
G40 G49 G80
G0 Z10
(CAMNC PAUSE start; rpm=15000)
M0 (MSG Spindle starts at 15000 RPM next. Manual spindle: turn it on now)
M3 S15000
G4 P3
(OP 1/1 Pocket 1 z=3.5 - T1 D=3.175)
(PASS 1/2 Z3.5)
X10.412 Y3.588
Z6
G1 Z5 F480
Y4.308 Z4.962 F360
Y5.029 Z4.924
Y5.75 Z4.887
Y6.471 Z4.849
Y7.192 Z4.811
Y7.913 Z4.773
X9.654 Z4.734
X8.896 Z4.694
X8.137 Z4.654
X7.379 Z4.614
X6.621 Z4.575
X5.862 Z4.535
X5.104 Z4.495
X4.346 Z4.455
X3.588 Z4.416
Y7.192 Z4.378
Y6.471 Z4.34
Y5.75 Z4.302
Y5.029 Z4.265
Y4.308 Z4.227
Y3.588 Z4.189
X4.346 Z4.149
X5.104 Z4.11
X5.863 Z4.07
X6.621 Z4.03
X7.379 Z3.99
X8.137 Z3.951
X8.896 Z3.911
X9.654 Z3.871
X10.412 Z3.831
Y4.308 Z3.794
Y5.029 Z3.756
Y5.75 Z3.718
Y6.471 Z3.68
Y7.192 Z3.642
Y7.913 Z3.605
X9.747 Z3.57
X9.081 Z3.535
X8.416 Z3.5
X7.75 F720
X7.084
X6.419
X5.753
X5.088
X4.338
X3.588
Y7.163
Y6.413
Y5.75
Y5.087
Y4.338
Y3.588
X4.338
X5.088
X5.853
X6.617
X7.382
X8.147
X8.912
X9.662
X10.412
Y4.338
Y5.087
Y5.75
Y6.413
Y7.163
Y7.913
X9.662
X8.912
X8.416
(PASS 2/2 Z3.5)
G0 Z7
X8.033 Y7.301
Z6
G1 Z3.5 F480
G2 X8.59 Y6.716 I-0.826 J-1.346 F720
X8.787 Y5.55 I-1.704 J-0.888
X7.2 Y3.963 I-1.587 J0
X6.221 Y4.072 I-0.262 J2.094
X5.661 Y4.444 I0.579 J1.479
X5.213 Y5.95 I1.303 J1.208
X6.8 Y7.538 I1.587 J0
X8.033 Y7.301 I0.285 J-1.848
G0 Z10
M5
G53 G0 Z-5
(CAMNC PAUSE done)
M0 (MSG Program done. Manual spindle: off now)
M30
