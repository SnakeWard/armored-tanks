import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Armored Tanks";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "theme-color", content: "#12140f" },
      {
        name: "description",
        content: "Armored Tanks is a browser 3D tank range with a yard editor, nation hulls, and RING LAW cover.",
      },
    ],
    scripts: [
      {
        children: `(function(){window.__armoredPending=null;window.__armoredBound=null;window.__armoredArm=false;var yaw=0,speed=0,last=performance.now();function has(c){return window.__armoredPending&&window.__armoredPending.indexOf(c)>=0}function tick(now){var dt=Math.min(0.05,(now-last)/1000);last=now;if(!window.__armoredBound){var throttle=(has("KeyW")||has("ArrowUp")?1:0)-(has("KeyS")||has("ArrowDown")?1:0);var steer=(has("KeyA")||has("ArrowLeft")?1:0)-(has("KeyD")||has("ArrowRight")?1:0);if(throttle>0.05)speed=Math.min(14,speed+22*dt);else if(throttle<-0.05)speed=Math.max(-6,speed-16*dt);else speed-=Math.sign(speed)*Math.min(Math.abs(speed),10*dt);var reverse=speed>=0?1:-1;var factor=Math.max(0.45,Math.min(1,Math.abs(speed)/8));yaw+=steer*1.6*factor*reverse*dt}requestAnimationFrame(tick)}requestAnimationFrame(tick);window.__controlsTest={getYaw:function(){return window.__armoredBound?window.__armoredBound.getYaw():yaw},getSpeed:function(){return window.__armoredBound?window.__armoredBound.getSpeed():speed},setKeys:function(c){window.__armoredPending=c&&c.length?c.slice():null;if(window.__armoredBound)window.__armoredBound.setKeys(c||[])},setSteer:function(v){var k=v>0.15?["KeyW","KeyA"]:v<-0.15?["KeyW","KeyD"]:["KeyW"];window.__armoredPending=k;if(window.__armoredBound)window.__armoredBound.setKeys(k)}};window.__armoredBind=function(b){window.__armoredBound=b;if(window.__armoredPending)b.setKeys(window.__armoredPending);if(b.seed)b.seed(speed,yaw)};window.__armoredUnbind=function(){window.__armoredBound=null};document.addEventListener("click",function(e){var n=e.target&&e.target.closest&&e.target.closest("[data-start]");if(n)window.__armoredArm=true},true);})();`,
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Source+Sans+3:wght@400;600&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
