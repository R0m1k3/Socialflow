
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, StopCircle, RefreshCw, CheckCircle, X, RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

interface CameraRecorderProps {
    onCapture: (file: File) => void;
    onCancel: () => void;
}

// Quality configurations
type VideoQuality = "4k" | "1080p" | "720p";

interface QualityConfig {
    label: string;
    width: number;
    height: number;
    bitrate: number;
}

const QUALITY_CONFIGS: Record<VideoQuality, QualityConfig> = {
    "4k": { label: "4K Ultra HD", width: 3840, height: 2160, bitrate: 25000000 },
    "1080p": { label: "Full HD", width: 1920, height: 1080, bitrate: 8000000 },
    "720p": { label: "HD 720p", width: 1280, height: 720, bitrate: 5000000 },
};

export function CameraRecorder({ onCapture, onCancel }: CameraRecorderProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const { toast } = useToast();

    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [timer, setTimer] = useState(0);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
    const [resolutionInfo, setResolutionInfo] = useState<string>('');
    const [quality, setQuality] = useState<VideoQuality>('1080p');
    const [showSettings, setShowSettings] = useState(false);

    // Initialisation de la caméra
    const startCamera = useCallback(async () => {
        try {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            const config = QUALITY_CONFIGS[quality];
            console.log(`📸 Starting camera: ${config.label}, facing: ${facingMode}`);

            // Simple constraints that work on all devices
            const simpleConstraints: MediaStreamConstraints = {
                audio: true,
                video: {
                    facingMode: facingMode,
                    width: { ideal: config.width },
                    height: { ideal: config.height },
                }
            };

            let newStream: MediaStream;

            try {
                // Try to get camera with simple constraints
                newStream = await navigator.mediaDevices.getUserMedia(simpleConstraints);
                console.log('✅ Camera obtained with simple constraints');
            } catch (err) {
                console.warn('⚠️ Simple constraints failed, trying minimal:', err);
                // Fallback to minimal constraints
                newStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: { facingMode: facingMode }
                });
                console.log('✅ Camera obtained with minimal constraints');
            }

            setStream(newStream);

            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
                videoRef.current.volume = 0;
                // Ensure video plays on iOS
                await videoRef.current.play().catch(() => { });
            }

            // Check actual resolution
            const videoTrack = newStream.getVideoTracks()[0];
            if (videoTrack) {
                const settings = videoTrack.getSettings();
                const resText = `${settings.width}x${settings.height}`;
                console.log('✅ Camera started at:', resText);
                setResolutionInfo(resText);
            }

        } catch (error) {
            console.error('❌ Error accessing camera:', error);
            toast({
                title: "Erreur caméra",
                description: "Impossible d'accéder à la caméra. Vérifiez les permissions.",
                variant: "destructive"
            });
            onCancel();
        }
    }, [facingMode, quality, onCancel, toast]);

    useEffect(() => {
        startCamera();
        return () => {
            // Cleanup on unmount
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [startCamera]);

    // Timer logic
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isRecording) {
            interval = setInterval(() => {
                setTimer(prev => prev + 1);
            }, 1000);
        } else {
            setTimer(0);
        }
        return () => clearInterval(interval);
    }, [isRecording]);

    const startRecording = () => {
        if (!stream) return;

        chunksRef.current = [];

        // Essayer les codecs supportés pour la meilleure qualité
        // iOS (Safari) supporte bien video/mp4 ou video/webkit;codecs=h264
        let mimeType = 'video/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp9';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm';
            }
        }

        console.log('🎥 Recording with mimeType:', mimeType);

        try {
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 8000000 // 8 Mbps target
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                setRecordedBlob(blob);
                const url = URL.createObjectURL(blob);
                setPreviewUrl(url);

                // Stop stream tracks to save battery while reviewing
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start(1000); // Collect chunks every second
            mediaRecorderRef.current = mediaRecorder;
            setIsRecording(true);
        } catch (e) {
            console.error('Failed to start recording:', e);
            toast({
                title: "Erreur enregistrement",
                description: "Format vidéo non supporté par ce navigateur.",
                variant: "destructive"
            });
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    const switchCamera = () => {
        setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    };

    const handleRetake = () => {
        setRecordedBlob(null);
        setPreviewUrl(null);
        startCamera(); // Restart stream
    };

    const handleConfirm = () => {
        if (recordedBlob) {
            // Create a File object
            const file = new File([recordedBlob], `capture-${Date.now()}.mp4`, {
                type: recordedBlob.type
            });
            onCapture(file);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Rendu : Mode Revue
    if (recordedBlob && previewUrl) {
        return (
            <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-4">
                <video
                    src={previewUrl}
                    controls
                    className="w-full max-h-[80vh] rounded-lg mb-8"
                    autoPlay
                    playsInline
                />
                <div className="flex gap-4">
                    <Button
                        variant="secondary"
                        size="lg"
                        onClick={handleRetake}
                        className="rounded-full px-8 py-6 text-lg"
                    >
                        <RotateCcw className="mr-2 h-5 w-5" />
                        Refaire
                    </Button>
                    <Button
                        size="lg"
                        onClick={handleConfirm}
                        className="rounded-full px-8 py-6 text-lg bg-green-600 hover:bg-green-700"
                    >
                        <CheckCircle className="mr-2 h-5 w-5" />
                        Valider
                    </Button>
                </div>
            </div>
        );
    }

    // Rendu : Mode Capture
    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 z-10 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent">
                <Button variant="ghost" size="icon" onClick={onCancel} className="text-white">
                    <X className="h-6 w-6" />
                </Button>
                <div className="flex items-center gap-2">
                    {/* Recording timer or quality selector */}
                    {isRecording ? (
                        <div className="bg-red-600 px-3 py-1 rounded-full text-white font-mono text-sm flex items-center gap-2">
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                            {formatTime(timer)}
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="bg-black/50 backdrop-blur-md px-3 py-2 rounded-full text-white font-medium text-sm flex items-center gap-2 border border-white/30"
                        >
                            <Settings2 className="h-4 w-4" />
                            {quality.toUpperCase()}
                            <span className="text-white/60 text-xs">
                                {resolutionInfo || QUALITY_CONFIGS[quality].label}
                            </span>
                        </button>
                    )}
                </div>
                <Button variant="ghost" size="icon" onClick={switchCamera} className="text-white">
                    <RefreshCw className="h-6 w-6" />
                </Button>
            </div>

            {/* Quality Settings Panel */}
            {showSettings && !isRecording && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-black/80 backdrop-blur-md rounded-xl p-4 min-w-[200px]">
                    <p className="text-white text-sm font-medium mb-3 text-center">Qualité Vidéo</p>
                    <div className="flex gap-2">
                        {(Object.keys(QUALITY_CONFIGS) as VideoQuality[]).map((q) => (
                            <button
                                key={q}
                                onClick={() => {
                                    setQuality(q);
                                    setShowSettings(false);
                                }}
                                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${quality === q
                                    ? 'bg-white text-black'
                                    : 'bg-white/20 text-white hover:bg-white/30'
                                    }`}
                            >
                                {q.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    <p className="text-white/60 text-xs mt-2 text-center">
                        {QUALITY_CONFIGS[quality].label}
                    </p>
                </div>
            )}

            {/* Viewfinder */}
            <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute min-w-full min-h-full object-cover"
                />
            </div>

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-6 pb-10 flex flex-col items-center bg-gradient-to-t from-black/80 to-transparent">
                {/* Quality selector - visible before recording */}
                {!isRecording && (
                    <div className="flex gap-2 mb-6">
                        {(Object.keys(QUALITY_CONFIGS) as VideoQuality[]).map((q) => (
                            <button
                                key={q}
                                onClick={() => setQuality(q)}
                                className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${quality === q
                                    ? 'bg-white text-black'
                                    : 'bg-white/20 text-white border border-white/40'
                                    }`}
                            >
                                {q.toUpperCase()}
                            </button>
                        ))}
                    </div>
                )}

                {/* Record button */}
                {isRecording ? (
                    <button
                        onClick={stopRecording}
                        className="group relative flex items-center justify-center"
                    >
                        <div className="absolute inset-0 rounded-full border-4 border-white opacity-100 group-hover:scale-105 transition-transform" />
                        <div className="w-16 h-16 rounded-lg bg-red-600 flex items-center justify-center animate-pulse">
                            <div className="w-6 h-6 bg-transparent" />
                        </div>
                    </button>
                ) : (
                    <button
                        onClick={startRecording}
                        className="group relative flex items-center justify-center"
                    >
                        <div className="w-20 h-20 rounded-full border-[6px] border-white flex items-center justify-center transition-all group-hover:scale-105 group-active:scale-95">
                            <div className="w-16 h-16 rounded-full bg-red-600" />
                        </div>
                    </button>
                )}
            </div>
        </div>
    );
}
