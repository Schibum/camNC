import { Text } from '@react-three/drei';
import React from 'react';

interface ErrorMessageProps {
  error: string | null;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ error }) => {
  if (!error) return null;

  return (
    <mesh position={[0, 0, 1]}>
      <planeGeometry args={[200, 50]} />
      <meshBasicMaterial color="red" transparent opacity={0.7} />
      <Text position={[0, 0, 0.1]} fontSize={10} color="white">
        {error}
      </Text>
    </mesh>
  );
};
