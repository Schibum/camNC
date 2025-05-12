import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@wbcnc/ui/components/card";

export function ServerCard({ status }: { status: string }) {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center">
          CNC Cam
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          <span className="font-semibold">Connection Status:</span> {status}
        </p>
      </CardContent>
    </Card>
  );
}
