
import React, { useRef, useState, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, StopCircle, RefreshCw, CheckCircle, X, RotateCcw, Settings2, AlertCircle, Video } from 'lucide-react';
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
}

const QUALITY_CONFIGS: Record<VideoQuality, QualityConfig> = {
    "4k": { label: "4K Ultra HD", width: 3840, height: 2160 },
    "1080p": { label: "Full HD", width: 1920, height: 1080 },
    "720p": { label: "HD 720p", width: 1280, height: 720 },
};

export function CameraRecorder({ onCapture, onCancel }: CameraRecorderProps) {
    const webcamRef = useRef<Webcam>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const { toast } = useToast();

    const [isRecording, setIsRecording] = useState(false);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [timer, setTimer] = useState(0);

    // Devices & Settings
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    const [quality, setQuality] = useState<VideoQuality>('1080p');
    const [showSettings, setShowSettings] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);

    // Fetch devices
    const handleDevices = useCallback((mediaDevices: MediaDeviceInfo[]) => {
        const videoDevices = mediaDevices.filter(({ kind }) => kind === "videoinput");
        setDevices(videoDevices);
        if (videoDevices.length > 0 && !selectedDeviceId) {
            setSelectedDeviceId(videoDevices[0].deviceId);
        }
    }, [selectedDeviceId]);

    useEffect(() => {
        navigator.mediaDevices.enumerateDevices().then(handleDevices).catch(err => {
            console.error("Error enumerating devices", err);
            setCameraError("Erreur liste périphériques: " + err.message);
        });
    }, [handleDevices]);

    // Timer
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isRecording) {
            interval = setInterval(() => setTimer(t => t + 1), 1000);
        } else {
            setTimer(0);
        }
        return () => clearInterval(interval);
    }, [isRecording]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Recording Logic
    const startRecording = useCallback(() => {
        if (!webcamRef.current || !webcamRef.current.stream) return;

        chunksRef.current = [];
        const stream = webcamRef.current.stream;

        const mimeTypes = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
        const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

        try {
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 8000000
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
                setRecordedBlob(blob);
                setPreviewUrl(URL.createObjectURL(blob));
            };

            mediaRecorder.start();
            mediaRecorderRef.current = mediaRecorder;
            setIsRecording(true);
        } catch (e: any) {
            console.error("Recording error", e);
            toast({ title: "Erreur", description: "Impossible de lancer l'enregistrement: " + e.message, variant: "destructive" });
        }
    }, [webcamRef, toast]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    }, [isRecording]);

    const handleConfirm = () => {
        if (recordedBlob) {
            onCapture(new File([recordedBlob], `capture-${Date.now()}.mp4`, { type: recordedBlob.type }));
        }
    };

    const handleUserMediaError = useCallback((error: string | DOMException) => {
        console.error("Webcam Error:", error);
        const msg = typeof error === 'string' ? error : error.message;
        setCameraError(msg);
    }, []);

    // Review Mode
    if (recordedBlob && previewUrl) {
        return (
            <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-4">
                <video src={previewUrl} controls className="w-full max-h-[80vh] rounded-lg mb-8" autoPlay playsInline />
                <div className="flex gap-4">
                    <Button variant="secondary" size="lg" onClick={() => { setRecordedBlob(null); setPreviewUrl(null); }} className="rounded-full px-8 py-6 text-lg">
                        <RotateCcw className="mr-2 h-5 w-5" /> Refaire
                    </Button>
                    <Button size="lg" onClick={handleConfirm} className="rounded-full px-8 py-6 text-lg bg-green-600 hover:bg-green-700">
                        <CheckCircle className="mr-2 h-5 w-5" /> Valider
                    </Button>
                </div>
            </div>
        );
    }

    const config = QUALITY_CONFIGS[quality];
    const videoConstraints = {
        width: { ideal: config.width },
        height: { ideal: config.height },
        deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
        facingMode: selectedDeviceId ? undefined : "user"
    };

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 z-10 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                <div className="pointer-events-auto">
                    <Button variant="ghost" size="icon" onClick={onCancel} className="text-white bg-black/20 hover:bg-black/40">
                        <X className="h-6 w-6" />
                    </Button>
                </div>

                <div className="pointer-events-auto flex gap-2">
                    {isRecording ? (
                        <div className="bg-red-600 px-3 py-1 rounded-full text-white font-mono text-sm flex items-center gap-2 animate-pulse">
                            <div className="w-2 h-2 bg-white rounded-full" />
                            {formatTime(timer)}
                        </div>
                    ) : (
                        <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)} className="bg-black/30 border-white/20 text-white backdrop-blur">
                            <Settings2 className="mr-2 h-4 w-4" />
                            <span className="hidden sm:inline">Réglages</span>
                        </Button>
                    )}
                </div>
                <div className="w-10"></div>
            </div>

            {/* Error Overlay */}
            {cameraError && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
                    <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
                    <h3 className="text-xl font-bold text-red-500 mb-2">Erreur Caméra</h3>
                    <p className="text-white mb-6">{cameraError}</p>
                    <p className="text-sm text-gray-400">Vérifiez vos permissions et que vous êtes bien en HTTPS (ou localhost).</p>
                    <Button onClick={() => window.location.reload()} variant="outline" className="mt-4 text-black">Recharger</Button>
                </div>
            )}

            {/* Settings Overlay */}
            {showSettings && !isRecording && (
                <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#1c1c1e] text-white p-6 rounded-2xl w-full max-w-sm border border-white/10 shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-lg font-bold">Paramètres</h2>
                            <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)}>
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-white/70">Caméra</label>
                                <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                                    <SelectTrigger className="w-full bg-white/5 border-white/10 text-white mt-1">
                                        <SelectValue placeholder="Choisir..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#2c2c2e] border-white/10 text-white">
                                        {devices.map((device) => (
                                            <SelectItem key={device.deviceId} value={device.deviceId}>
                                                {device.label || `Caméra ${device.deviceId.slice(0, 5)}...`}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-white/70">Qualité</label>
                                <div className="grid grid-cols-3 gap-2 mt-1">
                                    {(Object.keys(QUALITY_CONFIGS) as VideoQuality[]).map((q) => (
                                        <button
                                            key={q}
                                            onClick={() => setQuality(q)}
                                            className={`px-2 py-2 rounded text-sm border transition-colors ${quality === q ? 'bg-white text-black' : 'bg-transparent text-white border-white/20 hover:bg-white/10'}`}
                                        >
                                            {q.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <Button className="w-full mt-6 bg-white text-black hover:bg-gray-200" onClick={() => setShowSettings(false)}>OK</Button>
                    </div>
                </div>
            )}

            {/* Webcam Feed */}
            <div className="flex-1 bg-black flex items-center justify-center overflow-hidden relative">
                <Webcam
                    audio={true}
                    ref={webcamRef}
                    videoConstraints={videoConstraints}
                    onUserMediaError={handleUserMediaError}
                    className="absolute w-full h-full object-cover"
                    muted // Local preview always muted to avoid feedback
                />
            </div>

            {/* Footer Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-8 pb-12 flex flex-col items-center justify-end bg-gradient-to-t from-black/80 to-transparent h-48 pointer-events-none">
                <div className="pointer-events-auto">
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        className="group relative flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                    >
                        <div className={`w-20 h-20 rounded-full border-[6px] border-white flex items-center justify-center p-1 ${isRecording ? 'opacity-100' : ''}`}>
                            <div className={`transition-all duration-300 ${isRecording ? 'w-8 h-8 rounded-md bg-red-500' : 'w-full h-full rounded-full bg-red-500'}`} />
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default CameraRecorder;
