import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { CodecName, connect } from "@wbcnc/go2webrtc/client";
import { createClient } from "@wbcnc/go2webrtc/trystero";
import { genRandomWebtorrent } from "@wbcnc/go2webrtc/url-helpers";
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
import { useQRCode } from "next-qrcode";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

export const Route = createFileRoute("/go2webrtc")({
  component: RouteComponent,
});

const SERVE_URL_WEBTORRENT =
  "https://present-toolpath-webrtc-cam.vercel.app/webtorrent";
const SERVE_URL_TRYSTERO =
  "https://present-toolpath-webrtc-cam.vercel.app/webrtc-custom";

const formSchema = z
  .object({
    method: z.enum(["webtorrent", "webrtc+custom"]).optional(),
    // .default("webtorrent"),
    connectionString: z.string(),
    preferredCodec: z.string().optional(),
  })
  .refine(
    (data) => {
      const prefix =
        data.method === "webtorrent" ? "webtorrent:?" : "webrtc+custom://?";
      if (!data.connectionString.startsWith(prefix)) return false;
      try {
        const params = new URLSearchParams(
          data.connectionString.substring(prefix.length)
        );
        return params.has("share") && params.has("pwd");
      } catch (e) {
        return false;
      }
    },
    {
      message: "Invalid format. Expected: [method]?[share=...&pwd=...]",
      path: ["connectionString"],
    }
  );

type FormValues = z.infer<typeof formSchema>;
type ParsedValues = { share: string; pwd: string };

function parseConnectionString(connectionString: string): ParsedValues | null {
  const webtorrentPrefix = "webtorrent:?";
  const trysteroPrefix = "webrtc+custom://?";
  let paramsString = "";

  if (connectionString.startsWith(webtorrentPrefix)) {
    paramsString = connectionString.substring(webtorrentPrefix.length);
  } else if (connectionString.startsWith(trysteroPrefix)) {
    paramsString = connectionString.substring(trysteroPrefix.length);
  } else {
    return null;
  }

  try {
    const params = new URLSearchParams(paramsString);
    const share = params.get("share");
    const pwd = params.get("pwd");

    if (share && pwd) {
      return { share, pwd };
    }
    return null;
  } catch (e) {
    console.error("Failed to parse connection string params:", e);
    return null;
  }
}

function getDefaultTorrent() {
  let connectionString = localStorage.go2webrtcConnectionString;
  if (
    !connectionString ||
    (!connectionString.startsWith("webtorrent:?") &&
      !connectionString.startsWith("webrtc+custom://?"))
  ) {
    connectionString = genRandomWebtorrent();
    localStorage.go2webrtcConnectionString = connectionString;
  }
  return connectionString;
}

export function ConnectionQR({
  method,
  connectionString,
}: {
  method: FormValues["method"];
  connectionString: string;
}) {
  const parsed = parseConnectionString(connectionString);
  const { SVG } = useQRCode();
  if (!parsed) {
    return null;
  }
  const { share, pwd } = parsed;
  const params = new URLSearchParams({
    share,
    pwd,
  });
  const baseUrl =
    method === "webtorrent" ? SERVE_URL_WEBTORRENT : SERVE_URL_TRYSTERO;
  const url = `${baseUrl}?${params.toString()}`;
  return <SVG text={url} />;
}

function useVideoResolution(
  videoRef: React.RefObject<HTMLVideoElement | null>
) {
  const [videoResolution, setVideoResolution] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  useEffect(() => {
    if (!videoRef.current) return;

    const updateResolution = () => {
      if (videoRef.current) {
        setVideoResolution({
          width: videoRef.current.videoWidth,
          height: videoRef.current.videoHeight,
        });
      }
    };

    updateResolution();

    const video = videoRef.current;
    video.addEventListener("loadedmetadata", updateResolution);

    const intervalId = setInterval(updateResolution, 1000);

    return () => {
      video.removeEventListener("loadedmetadata", updateResolution);
      clearInterval(intervalId);
    };
  }, [videoRef]);

  return videoResolution;
}

export function ConnectForm({
  onConnect,
}: {
  onConnect: (
    values: ParsedValues,
    method: FormValues["method"],
    preferredCodec?: string
  ) => void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      connectionString: getDefaultTorrent(),
      // preferredCodec: undefined,
      method: "webrtc+custom",
      // ...(getDefaultTorrent().startsWith("webrtc+custom://?") && {
      //   method: "webrtc+custom" as const,
      // }),
    },
  });

  const currentMethod = form.watch("method");

  function onNewRandomTorrent() {
    const webtorrentBase = genRandomWebtorrent().substring(
      "webtorrent:?".length
    );
    const newTorrent =
      currentMethod === "webtorrent"
        ? `webtorrent:?${webtorrentBase}`
        : `webrtc+custom://?${webtorrentBase}`;
    form.setValue("connectionString", newTorrent);
  }

  function onSubmit(values: FormValues) {
    localStorage.go2webrtcConnectionString = values.connectionString;
    const parsed = parseConnectionString(values.connectionString);
    if (parsed) {
      onConnect(parsed, values.method, values.preferredCodec);
    } else {
      console.error(
        "Invalid connection string passed submit validation:",
        values.connectionString
      );
    }
  }

  const connectionStringPlaceholder =
    currentMethod === "webtorrent"
      ? "webtorrent:?share=...&pwd=..."
      : "webrtc+custom://?share=...&pwd=...";
  const connectionStringDescription =
    currentMethod === "webtorrent"
      ? "Paste the full webtorrent connection string."
      : "Paste the full webrtc+custom connection string.";

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 max-w-sm"
      >
        <FormField
          control={form.control}
          name="method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Connection Method</FormLabel>
              <FormControl>
                <Select
                  onValueChange={(value: string) => {
                    field.onChange(value);
                    const currentVal = form.getValues("connectionString");
                    const parsed = parseConnectionString(currentVal);
                    if (parsed) {
                      const newPrefix =
                        value === "webtorrent"
                          ? "webtorrent:?"
                          : "webrtc+custom://?";
                      const params = new URLSearchParams({
                        share: parsed.share,
                        pwd: parsed.pwd,
                      }).toString();
                      form.setValue(
                        "connectionString",
                        `${newPrefix}${params}`
                      );
                    } else {
                      form.setValue("connectionString", "");
                    }
                  }}
                  value={field.value}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="webtorrent">WebTorrent</SelectItem>
                    <SelectItem value="webrtc+custom">WebRTC Custom</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="connectionString"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Connection String</FormLabel>
              <FormControl>
                <Input placeholder={connectionStringPlaceholder} {...field} />
              </FormControl>

              <FormDescription>{connectionStringDescription}</FormDescription>
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
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Codec (Optional) " />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={undefined as unknown as string}>
                      Auto
                    </SelectItem>
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
        <div className="flex gap-2">
          <Button type="submit">Connect</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onNewRandomTorrent}
          >
            Random
          </Button>
        </div>
        <ConnectionQR
          method={currentMethod}
          connectionString={form.watch("connectionString")}
        />
      </form>
    </Form>
  );
}

function RouteComponent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [codecInfo, setCodecInfo] = useState<string | null>(null);
  const videoResolution = useVideoResolution(videoRef);
  const trysteroDisconnectRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    return () => {
      trysteroDisconnectRef.current?.();
    };
  }, []);

  const onConnect = async (
    values: ParsedValues,
    method: FormValues["method"],
    preferredCodec?: string
  ) => {
    console.log(`connecting using ${method}`, values);

    await trysteroDisconnectRef.current?.();
    trysteroDisconnectRef.current = null;
    setCodecInfo(null);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    const handleStream = (stream: MediaStream) => {
      console.log("got stream", stream, videoRef.current);
      if (videoRef.current) {
        const vid = videoRef.current;
        vid.srcObject = stream;
        vid.play().catch((e) => console.error("Video play failed:", e));

        const videoTrack = stream.getVideoTracks()[0];
        videoTrack?.addEventListener("unmute", () => {
          const settings = videoTrack?.getSettings();
          console.log("video track settings", settings);
        });
      }
    };

    if (method === "webtorrent") {
      try {
        const stream = await connect({
          share: values.share,
          pwd: values.pwd,
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
          preferredCodec: preferredCodec as CodecName | undefined,
        });
        handleStream(stream);
      } catch (error) {
        console.error("webtorrent connection error", error);
        toast.error("Connection Failed", { description: String(error) });
      }
    } else if (method === "webrtc+custom") {
      try {
        const clientApi = createClient(
          {
            share: values.share,
            pwd: values.pwd,
            onStateChange: (state) => {
              console.log("Trystero client state:", state);
              toast.info("Status", {
                description: `Trystero: ${state}`,
                duration: state === "streaming" ? 3000 : Infinity,
                id: "status-toast",
              });
            },
          },
          { onStream: handleStream }
        ).connect();
        setCodecInfo("");

        trysteroDisconnectRef.current = clientApi.disconnect;
      } catch (error) {
        console.error("trystero connection error", error);
        toast.error("Connection Failed", { description: String(error) });
      }
    }
  };

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
      <div className="absolute top-0 left-0 z-20 text-xs text-muted-foreground bg-background/50 rounded-br-lg p-2 flex flex-col items-start">
        <span>
          {videoResolution.width}x{videoResolution.height}
        </span>
        {codecInfo && <span>Codec: {codecInfo}</span>}
      </div>

      <div
        className={`fixed inset-0 z-0 ${!isOverlayVisible ? "cursor-pointer" : ""}`}
        onClick={() => !isOverlayVisible && setIsOverlayVisible(true)}
      >
        <video
          ref={videoRef}
          controls
          playsInline
          muted
          autoPlay
          className="w-screen h-screen object-contain bg-black"
        />
      </div>
    </div>
  );
}
