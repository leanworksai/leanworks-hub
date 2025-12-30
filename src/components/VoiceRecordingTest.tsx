import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Play, Pause, Square, RotateCcw, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const RECORDING_DURATION = 10000; // 10 seconds in milliseconds

export function VoiceRecordingTest() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Set up canvas dimensions
  useEffect(() => {
    const updateCanvasSize = () => {
      if (waveformCanvasRef.current) {
        const canvas = waveformCanvasRef.current;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width || 600;
        canvas.height = rect.height || 120;
      }
    };

    // Set initial size after a brief delay to ensure DOM is ready
    const timer = setTimeout(updateCanvasSize, 100);
    window.addEventListener("resize", updateCanvasSize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateCanvasSize);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      stopPlayback();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsRecording(false);
    setCountdown(null);
    setAudioLevel(0);
  };

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  const startRecording = async () => {
    try {
      setError(null);
      audioChunksRef.current = [];
      setWaveformData([]);

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      // Set up audio context for visualization
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/ogg";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
        } else {
          const audio = new Audio(audioUrl);
          audioRef.current = audio;
        }
        
        setHasRecording(true);
        stopRecording();
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);

      // Start countdown
      let remaining = RECORDING_DURATION / 1000;
      setCountdown(remaining);
      countdownIntervalRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
        }
      }, 1000);

      // Start visualization loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const waveformArray = new Uint8Array(analyser.fftSize);

      const updateVisualization = () => {
        if (!analyserRef.current) return;

        analyser.getByteFrequencyData(dataArray);
        analyser.getByteTimeDomainData(waveformArray);

        // Calculate audio level (0-100)
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const level = Math.min(100, (average / 255) * 100);
        setAudioLevel(level);

        // Update waveform data (normalize to -1 to 1 range)
        const normalizedWaveform = Array.from(waveformArray).map((value) => (value - 128) / 128);
        setWaveformData(normalizedWaveform);

        // Draw waveform on canvas
        if (waveformCanvasRef.current) {
          const canvas = waveformCanvasRef.current;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);
            ctx.strokeStyle = "hsl(var(--primary))";
            ctx.lineWidth = 2;
            ctx.beginPath();

            const sliceWidth = width / normalizedWaveform.length;
            let x = 0;

            for (let i = 0; i < normalizedWaveform.length; i++) {
              const v = normalizedWaveform[i];
              const y = (v * height) / 2 + height / 2;
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
              x += sliceWidth;
            }

            ctx.stroke();
          }
        }

        if (analyserRef.current) {
          animationFrameRef.current = requestAnimationFrame(updateVisualization);
        }
      };

      updateVisualization();

      // Auto-stop after duration
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      }, RECORDING_DURATION);
    } catch (err: any) {
      console.error("Error starting recording:", err);
      setError(
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Microphone permission denied. Please allow microphone access in your browser settings."
          : err.name === "NotFoundError" || err.name === "DevicesNotFoundError"
          ? "No microphone found. Please connect a microphone and try again."
          : `Failed to start recording: ${err.message || "Unknown error"}`
      );
      stopRecording();
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
      
      audioRef.current.onended = () => {
        setIsPlaying(false);
      };
    }
  };

  const handleReset = () => {
    stopPlayback();
    stopRecording();
    setHasRecording(false);
    setError(null);
    setAudioLevel(0);
    setWaveformData([]);
    audioChunksRef.current = [];
    if (audioRef.current) {
      audioRef.current.src = "";
      URL.revokeObjectURL(audioRef.current.src);
    }
    if (waveformCanvasRef.current) {
      const ctx = waveformCanvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, waveformCanvasRef.current.width, waveformCanvasRef.current.height);
      }
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Audio Level Meter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Audio Level</span>
          {isRecording && countdown !== null && (
            <span className="font-mono font-semibold text-primary">
              {countdown}s
            </span>
          )}
        </div>
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-75 rounded-full",
              audioLevel > 80
                ? "bg-red-500"
                : audioLevel > 50
                ? "bg-yellow-500"
                : "bg-green-500"
            )}
            style={{ width: `${audioLevel}%` }}
          />
        </div>
      </div>

      {/* Waveform Visualization */}
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">Waveform</div>
        <div className="border rounded-lg bg-muted/30 p-2">
          <canvas
            ref={waveformCanvasRef}
            className="w-full h-24"
            style={{ maxWidth: "100%" }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {!hasRecording ? (
          <Button
            onClick={isRecording ? stopRecording : startRecording}
            variant={isRecording ? "destructive" : "default"}
            disabled={isPlaying}
            className="gap-2"
          >
            {isRecording ? (
              <>
                <Square className="h-4 w-4" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                Start Recording
              </>
            )}
          </Button>
        ) : (
          <>
            <Button
              onClick={handlePlayPause}
              variant="default"
              className="gap-2"
            >
              {isPlaying ? (
                <>
                  <Pause className="h-4 w-4" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Play
                </>
              )}
            </Button>
            <Button
              onClick={handleReset}
              variant="outline"
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </>
        )}
      </div>

      {hasRecording && !isRecording && (
        <p className="text-sm text-muted-foreground">
          Recording complete! Click Play to listen to your recording.
        </p>
      )}
    </div>
  );
}

