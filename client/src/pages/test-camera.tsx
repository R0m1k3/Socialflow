
import React, { useState } from 'react';
import { CameraRecorder } from '@/components/camera-recorder';
import { Button } from '@/components/ui/button';

export default function TestCameraPage() {
    const [capturedFile, setCapturedFile] = useState<File | null>(null);
    const [showCamera, setShowCamera] = useState(false);

    return (
        <div className="p-8 bg-gray-900 min-h-screen text-white">
            <h1 className="text-3xl font-bold mb-8">Test Caméra Isolé</h1>

            <div className="space-y-6">
                <Button onClick={() => setShowCamera(true)}>Ouvrir Caméra (react-webcam)</Button>

                {capturedFile && (
                    <div className="mt-8">
                        <h2 className="text-xl font-semibold mb-2">Fichier Capturé :</h2>
                        <p>Nom: {capturedFile.name}</p>
                        <p>Taille: {(capturedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                        <p>Type: {capturedFile.type}</p>
                        <video controls src={URL.createObjectURL(capturedFile)} className="mt-4 max-w-sm border border-white/20 rounded" />
                    </div>
                )}
            </div>

            {showCamera && (
                <CameraRecorder
                    onCapture={(file) => {
                        console.log("Captured:", file);
                        setCapturedFile(file);
                        setShowCamera(false);
                    }}
                    onCancel={() => setShowCamera(false)}
                />
            )}
        </div>
    );
}
