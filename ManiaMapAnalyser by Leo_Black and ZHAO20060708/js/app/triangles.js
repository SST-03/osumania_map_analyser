// 动态 osu! 三角层。
//
// 三角形只在初始化时生成一次为 DOM 节点；向上漂浮的动画完全交给 CSS 合成器
// （只动 transform / opacity），因此运行期没有逐帧 JS 开销，适合压在节奏游戏
// 之上的实时悬浮窗。
//
// 颜色统一取自 --ma-accent（由 coverTheme.js 在换图时设置），所以封面主题一变，
// 整片三角会自动跟着换色，无需在这里碰颜色。

const TRIANGLE_COUNT = 18;

function rand(min, max) {
    return min + Math.random() * (max - min);
}

/**
 * 在 .triangle-field 容器内填充若干漂浮三角形。
 * @param {HTMLElement} [container] 三角容器；缺省时自动在卡片内查找。
 */
export function initTriangleField(container) {
    const field = container
        || document.querySelector(".main-card .triangle-field")
        || document.querySelector(".triangle-field");
    if (!field) {
        return;
    }

    // 避免重复填充（例如初始化被调用多次）。
    if (field.dataset.populated === "1") {
        return;
    }
    field.dataset.populated = "1";

    const prefersReducedMotion = typeof window !== "undefined"
        && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < TRIANGLE_COUNT; i += 1) {
        const triangle = document.createElement("span");
        triangle.className = "triangle";

        const size = rand(24, 92);          // 边长 px：大小混搭，远近层次
        const left = rand(-6, 100);         // 水平位置 %
        const opacity = rand(0.05, 0.20);   // 透明度：始终很淡，不抢内容
        const duration = rand(11, 26);      // 单程时长 s：慢飘
        const delay = -rand(0, duration);   // 负延迟：一开始就分散在不同高度
        const drift = rand(-26, 26);        // 上升过程中的横向漂移 px
        const spin = rand(-18, 18);         // 轻微旋转 deg

        triangle.style.setProperty("--tri-size", `${size.toFixed(1)}px`);
        triangle.style.setProperty("--tri-left", `${left.toFixed(2)}%`);
        triangle.style.setProperty("--tri-opacity", opacity.toFixed(3));
        triangle.style.setProperty("--tri-drift", `${drift.toFixed(1)}px`);
        triangle.style.setProperty("--tri-spin", `${spin.toFixed(1)}deg`);

        // 减弱动效时不设置 animation-duration/delay，CSS 里已把动画整体关掉，
        // 三角保持静止，仅作为静态纹理的补充。
        if (!prefersReducedMotion) {
            triangle.style.animationDuration = `${duration.toFixed(2)}s`;
            triangle.style.animationDelay = `${delay.toFixed(2)}s`;
        }

        fragment.appendChild(triangle);
    }

    field.appendChild(fragment);
}
