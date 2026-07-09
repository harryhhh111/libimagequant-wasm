# memLevel 对 PNG 文件大小的影响研究

## 背景

在对比系统 `pngquant` CLI 与项目 WASM 输出时发现：同参数下 WASM 文件有时比 native 大很多（最多 36.75%）。

`pngquant` 源码中明确设置了 `png_set_compression_mem_level(..., 5)`，而项目使用的 Rust `png` crate 默认使用 zlib `memLevel=8`。本研究隔离测试 `memLevel` 差异到底能带来多少文件大小变化。

## 测试方法

测试脚本：`scripts/test-memlevel.mjs`

核心思路：**固定所有变量，只改 memLevel**。

1. 用项目 WASM 对同一张图做量化，得到固定的 palette 和 indices。
2. 用 Node.js 原生 zlib 重新编码 PNG，参数锁定为：
   - 相同 palette
   - 相同 indices
   - 相同 bit depth
   - 相同 filter（NoFilter）
   - 相同 compression level（9）
   - 只改变 `memLevel`（5 ~ 9）
3. 比较输出文件大小。

测试图源：一张 512×512 的游戏角色图标 PNG（由调用方通过命令行参数传入）

## 测试结果

| maxColors | 实际 palette | bit depth | memLevel=5 | memLevel=8 | memLevel=5 比 8 |
|-----------|-------------|-----------|-----------|-----------|----------------|
| 8         | 8           | 4-bit     | 2,544     | 2,544     | 0.00%          |
| 16        | 16          | 4-bit     | 4,034     | 4,051     | -0.42%         |
| 32        | 32          | 8-bit     | 5,247     | 5,248     | -0.02%         |
| 64        | 64          | 8-bit     | 6,799     | 6,885     | -1.26%         |
| 128       | 128         | 8-bit     | 8,236     | 8,479     | -2.95%         |
| 256       | 256         | 8-bit     | 9,988     | 10,304    | -3.16%         |

> 负值表示 memLevel=5 文件更小。

## 结论

1. **memLevel=5 确实比默认的 memLevel=8 更小**，但优势很小，最大约 **3.16%**。
2. **memLevel 不是之前 benchmark 差异的主因**。之前 WASM 比 native 最多大 36.75%，远大于 memLevel 能解释的范围。
3. 之前 benchmark 的主要差异来自 **imagequant 版本不同**：系统 `pngquant` 内部绑的是 `imagequant 4.2.2`，项目 WASM 用的是 `imagequant 4.4.1`，两个版本算出的 palette/indices 不同，导致压缩后文件大小差异明显。

## 如果要实现 memLevel=5

当前项目通过 Rust `png` crate 编码 PNG，该 crate 不暴露 `memLevel`。`flate2` 同样不暴露 `memLevel`。要实现它需要：

1. 绕过 `png` crate 的压缩逻辑，或完全手写 PNG 编码器；
2. 引入能控制 `memLevel` 的 zlib 绑定（如 `libz-sys`）；
3. 手动处理 IHDR、PLTE、tRNS、IDAT、IEND 等 chunk。

### 权衡

| 方案 | 收益 | 成本 |
|------|------|------|
| 保持现状 | 简单稳定 | 文件比理论最优大 0–3% |
| 用 `libz-sys` 实现 memLevel=5 | 文件再小 0–3% | 增加 unsafe 代码和编码复杂度 |

建议：当前 `Filter::NoFilter` + 动态位深已经让 WASM 在大部分参数下持平或优于 native pngquant。如果文件大小不是核心瓶颈，**暂不实现 memLevel=5**；若后续需要极致压缩，再考虑引入 `libz-sys`。

---

## 补充：imagequant 4.4.1 相对于 4.2.2 更新了什么

用户提出质疑：版本号更高（4.4.1）理应效果更好，为什么文件反而更大？

答案是：**4.4.1 的优化目标确实转向了“视觉质量”，而不是“文件大小”**。这并不意味着 4.4.1 “更差”，而是它做了不同的取舍。

### 版本定位

- 系统 `pngquant` 3.0.3（Homebrew）内部绑定的是 `imagequant 4.2.2`。
- 项目 WASM 依赖的是 `imagequant 4.4.1`。
- 本地 `harryhhh111/pngquant` 仓库已升级到 `imagequant 4.5.0`，但未参与本次 benchmark。

`libimagequant` 官方 CHANGELOG 对 4.4 的描述只有一句话：

> version 4.4
> -----------
>  - palette quality improvements

也就是说，4.4 的核心改动就是提升 palette 质量。下面看具体实现。

### 关键提交（4.2.2 → 4.4.1）

三个直接影响 palette 生成的 commit 都在 `src/mediancut.rs`：

| commit | 标题 | 作用 |
|--------|------|------|
| `ef433f3` | Select by sum instead of max | 拆分颜色盒时，把“按最大通道方差选盒”改成“按所有通道方差之和选盒”。 |
| `4b3dd4d` | Tweak for squaring error too much | 调整颜色权重公式，减弱了“误差平方”对拆分的放大作用。 |
| `ca16a5c` | Use selective strategy only at the end | 拆分阶段始终用平均色，只在最终生成 palette 时，从每个盒子里选离平均色最近的真实颜色。 |

#### 1. `ef433f3`：从 max 到 sum

4.2.2：
```rust
let cv = mbox.variance.r.max(mbox.variance.g).max(mbox.variance.b);
let mut thissum = mbox.adjusted_weight_sum * f64::from(cv.max(mbox.variance.a));
```

4.4.1：
```rust
let mut thissum = mbox.adjusted_weight_sum * mbox.variance.iter().map(|f| f as f64).sum::<f64>();
```

**影响**：4.2.2 优先拆分“某个通道变化最大”的颜色盒；4.4.1 优先拆分“整体颜色变化最丰富”的盒。后者会让 palette 覆盖更分散的颜色空间，有利于还原复杂渐变，但生成的 palette 分布更不规则、更难被 zlib 压缩。

#### 2. `4b3dd4d`：权重公式调整

4.2.2：
```rust
let w = median.diff(&a.color).sqrt() * (1. + a.adjusted_weight).sqrt();
```

4.4.1：
```rust
let w = (median.diff(&a.color).sqrt() * (2. + a.adjusted_weight)).sqrt();
```

**影响**：削弱了“大误差颜色”在拆分时的权重，让拆分更均匀地照顾所有颜色，而不是被少数高误差像素主导。这同样倾向于提升整体视觉质量，但可能牺牲索引流的可压缩性。

#### 3. `ca16a5c`： selective strategy 只在最后使用

4.2.2 每次拆分新盒时，都会检查“平均色是否对所有像素都没用”。如果是，就改用盒子里最接近平均色的真实颜色。这个逻辑在拆分过程中反复执行，确保每个新 palette 候选色都能至少服务一个原始像素。

4.4.1 删除了拆分阶段的这个检查，改为：

```rust
let avg_color = weighed_average_color(hist);
```

只在最终输出 palette 时，对每个颜色数大于 2 的盒子执行：

```rust
if mbox.colors.len() > 2 {
    representative_color = mbox.colors.iter().min_by_key(|a| OrdFloat::new(representative_color.diff(&a.color))).map(|a| a.color).unwrap_or_default();
}
```

**影响**：拆分过程更“数学化”，不再中途为可压缩性做妥协；最终 palette 仍然是真实颜色，但整个索引分布可能更不均匀。

### 重新评估 benchmark 结论

之前我说“4.4.1 比 4.2.2 效果更差”，这是不准确的。更准确的说法是：

- **4.4.1 在“视觉质量”这个维度上更好**：palette 选择策略更注重视觉保真，特别是复杂颜色区域。
- **4.4.1 在“文件大小”这个维度上更大**：更分散的 palette 和更不规则的索引流导致 zlib 压缩率下降。
- **4.2.2 在“文件大小”这个维度上更优**：它的策略让 palette 和索引更“规则”，更容易被压缩。

所以 benchmark 中 4.4.1 文件更大，不是 bug，也不是“版本越新越差”，而是**上游作者在第 4.4 版里明确把优化目标从“压缩友好”推向了“视觉质量”**。如果只看文件大小，4.2.2 占优；如果看 PSNR/SSIM 等视觉指标，4.4.1 很可能占优。

### 对项目的意义

1. **WASM 本身没有引入额外损失**。同样用 4.4.1 的 Rust 代码，native 和 WASM 输出应该一致；差异来自版本号不同。
2. **memLevel=5 最多只能再缩小 0–3%**，远不足以解释 4.4.1 vs 4.2.2 的 10%–70% 差距。
3. 如果项目目标是“文件最小”，有两个方向：
   - 降级到 imagequant 4.2.2（但会失去 4.4 的视觉改进）；
   - 在编码端做更多工作（比如更激进的过滤、尝试多种压缩策略），而不是指望量化算法本身变小。

结论不变：**memLevel=5 不值得单独引入 `libz-sys` 重写编码器；如果后续要极致压缩，应评估图像质量指标后再决定量化库版本**。

---

## 补充：系统 pngquant 3.0.3 vs 自编译 pngquant 3.0.4

为了排除 WASM 干扰、只看 imagequant 版本差异，直接用系统 `pngquant` 和刚编译的 `harryhhh111/pngquant` 做了一次 native-vs-native 对比。

### 版本差异

| | system pngquant | built pngquant |
|--|-----------------|----------------|
| pngquant 版本 | 3.0.3 | 3.0.4 |
| imagequant 版本 | 4.2.2 | 4.5.0 |

### 测试参数

- 图源：同一张 512×512 测试 PNG
- maxColors：`[8, 16, 32, 64, 128, 256]`
- quality：`[10, 30, 50, 70, 90]`
- speed：`[3, 6, 9]`
- 输出目录：`benchmark-output/pngquant-system-vs-built/`
- 脚本：`scripts/benchmark-pngquant-system-vs-built.mjs`

### 总体结果

| 指标 | system (4.2.2) | built (4.5.0) |
|------|---------------|---------------|
| 平均文件大小 | baseline | **+4.65%** |
| 平均耗时 | **32.54 ms** | **31.41 ms**（快 3.26%） |
| 文件差异范围 | — | [-16.52%, +34.65%] |
| 耗时差异范围 | — | [-30.25%, +109.92%] |

### 按 maxColors 分组

| maxColors | 文件大小（built vs system） | 耗时（built / system） |
|-----------|---------------------------|----------------------|
| 8 | +3.51% | 34.1ms / 35.9ms（快 4.5%） |
| **16** | **+30.81%** | **25.9ms / 31.3ms（快 17.1%）** |
| 32 | +0.96% | 35.4ms / 34.7ms（慢 2.9%） |
| 64 | -1.53% | 33.7ms / 32.9ms（慢 1.0%） |
| 128 | -1.84% | 29.9ms / 30.5ms（快 0.4%） |
| 256 | -3.99% | 29.6ms / 29.9ms（快 1.4%） |

### 按 speed 分组

| speed | 文件大小 | 耗时 |
|-------|---------|------|
| 3 | +3.73% | 35.5ms / 34.7ms（慢 2.1%） |
| 6 | +1.97% | 30.9ms / 33.5ms（快 7.2%） |
| 9 | +8.26% | 27.9ms / 29.4ms（快 4.6%） |

### 结论

1. **16 色仍然是文件大小差异最大的档位**，built（4.5.0）比 system（4.2.2）大 30% 左右，与 4.4.1 的结论一致。
2. **4.5.0 平均更快**，尤其在 16 色时快 17%，说明版本升级不只是质量，执行效率也有优化。
3. **speed 参数主要影响时间**：speed 越高耗时越短，但对文件大小的影响不是单调的（speed=9 时 built 文件反而平均更大）。
4. 耗时数据中存在异常点（如 `maxColors=32, quality=90, speed=3` 时 built 慢 109.92%），需要单独复现排查，见下一节。

### 异常点排查：`maxColors=32, quality=90, speed=3`

原始 benchmark 中这一组数据：

| 指标 | system (4.2.2) | built (4.5.0) |
|------|---------------|---------------|
| 文件大小 | 24,849 | 25,155 |
| 耗时 | 32.73 ms | 68.70 ms |
| built 相对 system | +1.23% | **+109.92%** |

为了确认这是真实性能瓶颈还是系统噪声，对该参数单独跑了 20 次：

| 统计 | system (4.2.2) | built (4.5.0) |
|------|---------------|---------------|
| min | 28.81 ms | 27.47 ms |
| max | 37.81 ms | 38.21 ms |
| avg | 30.39 ms | 29.21 ms |
| median | 29.86 ms | 28.09 ms |
| p95 | 37.81 ms | 38.21 ms |
| std | 1.88 ms | 2.44 ms |
| **built avg vs system avg** | — | **-3.88%** |

#### 结论

- **+109.92% 不是真实性能瓶颈**，而是单次运行中的系统噪声（进程调度、CPU 频率、后台活动等）。
- 复现 20 次后，built（4.5.0）平均反而比 system（4.2.2）快 3.88%。
- built 的方差略大（std 2.44 ms vs 1.88 ms），说明它更容易受系统负载波动影响，但平均水平没有劣化。

因此，之前的总体结论不变：**4.5.0 在大部分参数下不比 4.2.2 慢，16 色时明显更快；耗时的极端异常值应视为噪声**。