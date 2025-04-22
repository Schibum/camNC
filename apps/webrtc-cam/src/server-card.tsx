import { AlertDescription, AlertTitle } from "@wbcnc/ui/components/alert";

import { Alert } from "@wbcnc/ui/components/alert";
import { Button } from "@wbcnc/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@wbcnc/ui/components/card";
import { useWakeLock } from "@wbcnc/ui/hooks/use-wakelook";
import { AlertTriangle } from "lucide-react";
import { useCameraName } from "./utils";

export function ServerCard({ status }: { status: string }) {
  const { wakeLock, requestWakeLock } = useWakeLock();
  const cameraName = useCameraName();

  return (
    <Card className="w-full max-w-md mx-auto mt-10">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center">
          WebRTC Camera Stream
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          <span className="font-semibold">Camera:</span> {cameraName}
        </p>
        <p>
          <span className="font-semibold">Connection Status:</span> {status}
        </p>

        {!wakeLock ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Wake Lock Inactive</AlertTitle>
            <AlertDescription>
              To prevent the screen from turning off during streaming, please
              activate the wake lock.
              <Button onClick={requestWakeLock} className="mt-2">
                Request Wake Lock
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <p>
            <span className="font-semibold">Wake Lock:</span> Active
          </p>
        )}

        {/* <p>Share: {share}</p>
          <p>Pwd: {pwd}</p> */}
      </CardContent>
    </Card>
  );
}
