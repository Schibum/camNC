import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/go2webrtc")({
  component: RouteComponent,
});

import { zodResolver } from "@hookform/resolvers/zod";
import { CodecName, connect } from "@wbcnc/go2webrtc/client";
import { Button } from "@wbcnc/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@wbcnc/ui/components/form";
import { Input } from "@wbcnc/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wbcnc/ui/components/select";
import { toast } from "@wbcnc/ui/components/sonner";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const formSchema = z.object({
  connectionString: z.string().refine(
    (val) => {
      if (!val.startsWith("webtorrent:?")) return false;
      try {
        const params = new URLSearchParams(
          val.substring("webtorrent:?".length)
        );
        return params.has("share") && params.has("pwd");
      } catch (e) {
        return false;
      }
    },
    {
      message: "Invalid format. Expected: webtorrent:?share=...&pwd=...",
    }
  ),
  preferredCodec: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;
type ParsedValues = { shareName: string; password: string };

function parseConnectionString(connectionString: string): ParsedValues | null {
  try {
    if (!connectionString.startsWith("webtorrent:?")) {
      return null;
    }
    const params = new URLSearchParams(
      connectionString.substring("webtorrent:?".length)
    );
    const shareName = params.get("share");
    const password = params.get("pwd");
    if (shareName && password) {
      return { shareName, password };
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function ConnectForm({
  onConnect,
}: {
  onConnect: (values: ParsedValues, preferredCodec?: string) => void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      connectionString: "",
    },
  });

  function onSubmit(values: FormValues) {
    const parsed = parseConnectionString(values.connectionString);
    if (parsed) {
      onConnect(parsed, values.preferredCodec);
    } else {
      // Should not happen due to zod validation, but good practice
      console.error(
        "Invalid connection string passed submit validation:",
        values.connectionString
      );
      // Optionally set a form error
      // form.setError("connectionString", { type: "manual", message: "Invalid format." });
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 max-w-sm"
      >
        <FormField
          control={form.control}
          name="connectionString"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Connection String</FormLabel>
              <FormControl>
                <Input placeholder="webtorrent:?share=...&pwd=..." {...field} />
              </FormControl>
              <FormDescription>
                Paste the full connection string.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="preferredCodec"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred Codec</FormLabel>
              <FormControl>
                <Select onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a codec" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="H264">H264</SelectItem>
                    <SelectItem value="VP8">VP8</SelectItem>
                    <SelectItem value="VP9">VP9</SelectItem>
                    <SelectItem value="AV1">AV1</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Connect</Button>
      </form>
    </Form>
  );
}

function RouteComponent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [videoResolution, setVideoResolution] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });
  const [codecInfo, setCodecInfo] = useState<string | null>(null);

  const onConnect = async (values: ParsedValues, preferredCodec?: string) => {
    console.log("connecting", values);
    try {
      const stream = await connect({
        share: values.shareName,
        pwd: values.password,
        onStatusUpdate(update) {
          console.log("status update", update);
          toast.info("Status", {
            description: update,
            duration: update === "connected" ? 3000 : Infinity,
            id: "status-toast",
          });
        },
        onCodecInfo(codec) {
          setCodecInfo(codec);
        },
        preferredCodec: preferredCodec as CodecName,
      });
      console.log("got stream", stream, videoRef.current);
      if (videoRef.current) {
        const vid = videoRef.current;
        vid.srcObject = stream;
        vid.play();
      }
    } catch (error) {
      console.error("error", error);
    }
  };

  useEffect(() => {
    if (videoRef.current) {
      const vid = videoRef.current;
      if (vid.videoWidth && vid.videoHeight) {
        setVideoResolution({ width: vid.videoWidth, height: vid.videoHeight });
      } else {
        vid.addEventListener("loadedmetadata", () => {
          setVideoResolution({
            width: vid.videoWidth,
            height: vid.videoHeight,
          });
        });
      }
    }
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {isOverlayVisible && (
        <div className="relative z-10 p-4 md:p-8 bg-background/80 rounded-lg shadow-md max-w-xl mx-auto mt-4 md:mt-8">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 px-2 py-1 h-auto"
            onClick={() => setIsOverlayVisible(false)}
          >
            Hide
          </Button>
          <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Go2RTC WebRTC Demo</h1>
            <ConnectForm onConnect={onConnect} />
          </div>
        </div>
      )}
      <div className="absolute top-0 left-0 z-20 text-sm text-muted-foreground">
        {videoResolution.width}x{videoResolution.height}
        {codecInfo && <span>Codec: {codecInfo}</span>}
      </div>

      <div
        className={`fixed inset-0 z-0 ${!isOverlayVisible ? "cursor-pointer" : ""}`}
        onClick={() => !isOverlayVisible && setIsOverlayVisible(true)}
      >
        <video
          ref={videoRef}
          controls
          className="w-screen h-screen object-cover"
        />
      </div>
    </div>
  );
}
