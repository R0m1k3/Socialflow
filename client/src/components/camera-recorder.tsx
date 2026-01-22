
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, StopCircle, RefreshCw, CheckCircle, X, RotateCcw, Settings2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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

    // Camera Device State
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    const [permissionError, setPermissionError] = useState<string | null>(null);

    const [resolutionInfo, setResolutionInfo] = useState<string>('');
    const [quality, setQuality] = useState<VideoQuality>('1080p');
    const [showSettings, setShowSettings] = useState(false);

    // Fetch video devices
    useEffect(() => {
        const getDevices = async () => {
            try {
                // Request permission first to get device labels
                await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

                const allDevices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
                setDevices(videoDevices);

                if (videoDevices.length > 0 && !selectedDeviceId) {
                    setSelectedDeviceId(videoDevices[0].deviceId);
                }
            } catch (err) {
                console.error("Error enumerating devices:", err);
                setPermissionError("Accès caméra refusé ou non disponible.");
            }
        };
        getDevices();
    }, []);

    // Initialisation de la caméra
    const startCamera = useCallback(async () => {
        if (!selectedDeviceId && devices.length > 0) return; // Wait for selection logic

        try {
            setPermissionError(null);

            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            const config = QUALITY_CONFIGS[quality];
            console.log(`📸 Starting camera: ${config.label}, deviceId: ${selectedDeviceId}`);

            // Constraints with specific deviceId if selected, otherwise facingMode fallback
            const constraints: MediaStreamConstraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                },
                video: selectedDeviceId ? {
                    deviceId: { exact: selectedDeviceId },
                    width: { ideal: config.width },
                    height: { ideal: config.height },
                } : {
                    facingMode: 'user', // Default fallback
                    width: { ideal: config.width },
                    height: { ideal: config.height },
                }
            };

            let newStream: MediaStream;

            try {
                newStream = await navigator.mediaDevices.getUserMedia(constraints);
                console.log('✅ Camera obtained');
            } catch (err) {
                console.warn('⚠️ Constraints failed, trying minimal fallback:', err);
                // Fallback to minimal constraints (any video source)
                newStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: true
                });
                console.log('✅ Camera obtained with minimal constraints');
            }

            setStream(newStream);

            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
                videoRef.current.volume = 0;
                // Explicit play try
                try {
                    await videoRef.current.play();
                } catch (playErr) {
                    console.error("Video play failed:", playErr);
                }
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
            setPermissionError(error instanceof Error ? error.message : "Erreur inconnue");
            toast({
                title: "Erreur caméra",
                description: "Impossible d'accéder à la caméra. Vérifiez les permissions.",
                variant: "destructive"
            });
        }
    }, [selectedDeviceId, quality, toast, devices]); // Removed complex deps

    // Restart camera when device or quality changes
    useEffect(() => {
        if (selectedDeviceId) {
            startCamera();
        }
        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDeviceId, quality]);

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
        const mimeTypes = [
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ];

        let mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

        if (!mimeType) {
            console.warn("No supported mimeType found, letting browser decide default.");
        }

        console.log('🎥 Recording with mimeType:', mimeType);

        try {
            const options: MediaRecorderOptions = {
                videoBitsPerSecond: 8000000 // 8 Mbps target
            };
            if (mimeType) {
                options.mimeType = mimeType;
            }

            const mediaRecorder = new MediaRecorder(stream, options);

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
                setRecordedBlob(blob);
                const url = URL.createObjectURL(blob);
                setPreviewUrl(url);

                // Stop stream tracks to save battery while reviewing
                // stream.getTracks().forEach(track => track.stop()); // Don't stop yet if we want retake to be fast?
                // Actually retake restarts camera, so stopping here is fine.
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

    const handleRetake = () => {
        setRecordedBlob(null);
        setPreviewUrl(null);
        // Force restart
        startCamera();
    };

    const handleConfirm = () => {
        if (recordedBlob) {
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
            <div className="absolute top-0 left-0 right-0 p-4 z-10 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                <div className="pointer-events-auto">
                    <Button variant="ghost" size="icon" onClick={onCancel} className="text-white">
                        <X className="h-6 w-6" />
                    </Button>
                </div>

                <div className="flex items-center gap-2 pointer-events-auto">
                    {/* Recording timer or Settings Trigger */}
                    {isRecording ? (
                        <div className="bg-red-600 px-3 py-1 rounded-full text-white font-mono text-sm flex items-center gap-2">
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                            {formatTime(timer)}
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="bg-black/50 backdrop-blur-md px-3 py-2 rounded-full text-white font-medium text-sm flex items-center gap-2 border border-white/30 hover:bg-black/70 transition-colors"
                        >
                            <Settings2 className="h-4 w-4" />
                            <span className="hidden sm:inline">Paramètres</span>
                        </button>
                    )}
                </div>

                <div className="w-10"></div> {/* Spacer for alignment */}
            </div>

            {/* Error Message */}
            {permissionError && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 text-white p-6 text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                    <h3 className="text-xl font-bold mb-2">Erreur Caméra</h3>
                    <p className="text-white/70 mb-6">{permissionError}</p>
                    <Button onClick={onCancel} variant="outline" className="text-black">
                        Fermer
                    </Button>
                </div>
            )}

            {/* Settings Panel Overlay */}
            {showSettings && !isRecording && (
                <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#1c1c1e] text-white p-6 rounded-2xl w-full max-w-sm border border-white/10 shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-lg font-bold">Paramètres Caméra</h2>
                            <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)} className="h-8 w-8 text-white/50 hover:text-white">
                                <X className="h-5 w-5" />
                            </Button>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-white/70">Caméra</label>
                                <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                                    <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                                        <SelectValue placeholder="Sélectionner une caméra" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#2c2c2e] border-white/10 text-white">
                                        {devices.map((device) => (
                                            <SelectItem key={device.deviceId} value={device.deviceId} className="focus:bg-white/10 cursor-pointer">
                                                {device.label || `Caméra ${device.deviceId.slice(0, 5)}...`}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-white/70">Qualité</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(Object.keys(QUALITY_CONFIGS) as VideoQuality[]).map((q) => (
                                        <button
                                            key={q}
                                            onClick={() => setQuality(q)}
                                            className={`px-2 py-2 rounded-lg text-sm font-medium transition-all border ${quality === q
                                                ? 'bg-white text-black border-white'
                                                : 'bg-white/5 text-white border-transparent hover:bg-white/10'
                                                }`}
                                        >
                                            {q.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-white/40 text-center pt-1">
                                    {QUALITY_CONFIGS[quality].label} - {resolutionInfo}
                                </p>
                            </div>

                            <Button onClick={() => setShowSettings(false)} className="w-full bg-white text-black hover:bg-white/90">
                                Terminer
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Viewfinder */}
            <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                {!permissionError && (
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="absolute w-full h-full object-cover"
                    />
                )}
            </div>

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-8 pb-12 flex flex-col items-center justify-end bg-gradient-to-t from-black/80 to-transparent h-48 pointer-events-none">
                <div className="pointer-events-auto">
                    {isRecording ? (
                        <button
                            onClick={stopRecording}
                            className="group relative flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                        >
                            <div className="w-20 h-20 rounded-full border-[4px] border-white flex items-center justify-center">
                                <div className="w-8 h-8 rounded-md bg-red-500" />
                            </div>
                        </button>
                    ) : (
                        <button
                            onClick={startRecording}
                            className="group relative flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                        >
                            <div className="w-20 h-20 rounded-full border-[4px] border-white flex items-center justify-center p-1">
                                <div className="w-full h-full rounded-full bg-red-500" />
                            </div>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// Ensure TypeScript treats this as a module
export default CameraRecorder;
