import { useStore } from '@/store';
import { Card, CardContent, CardHeader, CardTitle } from '@wbcnc/ui/components/card';

export function BoundsInfo() {
  const bounds = useStore(s => s.toolpath?.getBounds());
  if (!bounds) return null;
  return (
    <Card className="p-1 gap-0 flex-auto">
      <CardHeader className="px-2 py-1 space-y-0">
        <CardTitle className="text-xs font-medium text-gray-700">Toolpath Bounds</CardTitle>
      </CardHeader>
      <CardContent className="px-2 py-1 pt-0 ">
        <div className="grid gap-0.5 text-xs text-gray-600">
          <div>
            X: [{bounds.min.x.toFixed(1)}, {bounds.max.x.toFixed(1)}]
          </div>
          <div>
            Y: [{bounds.min.y.toFixed(1)}, {bounds.max.y.toFixed(1)}]
          </div>
          <div>
            Z: [{bounds.min.z.toFixed(1)}, {bounds.max.z.toFixed(1)}]
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
