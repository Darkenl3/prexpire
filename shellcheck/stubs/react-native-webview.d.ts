// Type-check stub for react-native-webview (the shell pins 13.16.1 separately).
declare module 'react-native-webview' {
  import type { Component } from 'react';
  import type { StyleProp, ViewStyle } from 'react-native';

  export type WebViewMessageEvent = {
    nativeEvent: { data: string };
    bubbles: boolean;
    cancelable: boolean;
    target: unknown;
    currentTarget: unknown;
    defaultPrevented: boolean;
    eventPhase: number;
    isTrusted: boolean;
    timeStamp: number;
    type: string;
    isDefaultPrevented(): boolean;
    isPropagationStopped(): boolean;
    persist(): void;
    preventDefault(): void;
    stopPropagation(): void;
  };

  export interface WebViewProps {
    source: { uri: string };
    style?: StyleProp<ViewStyle>;
    javaScriptEnabled?: boolean;
    domStorageEnabled?: boolean;
    allowsBackForwardNavigationGestures?: boolean;
    startInLoadingState?: boolean;
    onMessage?: (event: WebViewMessageEvent) => void;
    [key: string]: unknown;
  }

  export class WebView extends Component<WebViewProps> {
    injectJavaScript(js: string): void;
    postMessage(message: string): void;
    reload(): void;
    goBack(): void;
    goForward(): void;
  }
}
