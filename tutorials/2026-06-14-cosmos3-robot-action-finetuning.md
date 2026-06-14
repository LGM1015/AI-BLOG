---
title: "基于NVIDIA Cosmos 3的机器人动作预测微调实战"
category: "physical-ai"
categoryName: "Physical AI"
date: "2026-06-14"
tags: ["NVIDIA Cosmos 3", "World Model", "Robot Action Prediction", "Fine-tuning", "Physical AI"]
description: "本文详细介绍如何对NVIDIA Cosmos 3世界基础模型进行后训练（Post-Training），将其微调为前向动力学模型，实现基于机器人动作输入的未来状态预测。"
---

NVIDIA在2026年6月发布的**Cosmos 3**是当前最强大的开源物理AI世界模型。与前代版本相比，Cosmos 3的突破在于引入了**原生动作模态（Native Action Modality）**——它可以直接输入机器人的关节角度、夹爪位置等动作信号，并输出预测的未来世界状态。

本文将手把手带你完成Cosmos 3的后训练流程，将通用世界模型微调为**前向动力学模型（Forward Dynamics Model）**，实现"给机器人一个动作，预测机器人将看到什么"这一核心能力。

## 一、前置知识：什么是前向动力学模型

在机器人领域，前向动力学模型是**给定当前状态+动作序列，预测下一个状态**的模型。

```
输入：[当前帧图像, 动作序列A1, A2, ..., An]
输出：[预测的未来帧图像序列]
```

举例：输入机器人当前摄像头画面 + 机械臂关节运动轨迹，模型输出的是"按照这个动作执行后，机械臂将运动到什么位置、夹爪将抓取到什么物体"。

这与强化学习中的"世界模型"概念高度吻合，是机器人策略学习（Policy Learning）的核心组成模块。

## 二、环境准备

### 2.1 硬件要求

- **GPU**: 8×H100 或 4×GB200（本文演示使用4×GB200）
- **显存**: 每卡至少80GB（H100）或等效
- **存储**: 至少500GB用于模型权重和数据集
- **网络**: 访问HuggingFace下载模型权重

### 2.2 安装依赖

```bash
# 克隆Cosmos 3官方仓库
git clone https://github.com/nvidia/Cosmos.git
cd Cosmos

# 创建conda环境
conda create -n cosmos3 python=3.10
conda activate cosmos3

# 安装PyTorch (根据你的CUDA版本选择)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# 安装Cosmos 3核心依赖
pip install -e ./packages/cosmos_encdec
pip install -e ./packages/cosmos_tokenizer
pip install -e ./packages/cosmos_diffusion

# 安装数据处理工具
pip install transformers datasets accelerate
pip install huggingface_hub

# 安装LeRobot格式支持（用于数据集转换）
pip install lerobot
```

### 2.3 下载Cosmos 3模型权重

Cosmos 3在HuggingFace上提供了多个规模的模型：

```bash
from huggingface_hub import snapshot_download

# 下载Cosmos 3 Nano模型（适合微调）
snapshot_download(
    repo_id="nvidia/Cosmos-3-VAE-4x4x4",
    local_dir="./checkpoints/cosmos3-nano"
)

snapshot_download(
    repo_id="nvidia/Cosmos-3-Diffusion-4B",
    local_dir="./checkpoints/cosmos3-diffusion-4B"
)
```

## 三、数据集准备

### 3.1 LeRobot格式

Cosmos 3要求数据采用**LeRobot格式**。每个数据样本包含：

```json
{
  "observation.images.primary": [H, W, 3] RGB图像,
  "observation.state.joint": [N] 关节角度数组,
  "action.actors.main": [M] 动作向量,
  "next_observation.images.primary": [H, W, 3] 下一帧图像,
  "next_observation.state.joint": [N] 下一状态关节角度
}
```

### 3.2 自定义数据转换脚本

假设你已有机器人数据（CSV或NumPy格式），可用以下脚本转换为LeRobot格式：

```python
import numpy as np
import json
from pathlib import Path

def convert_to_lerobot_format(input_dir, output_dir, fps=30):
    """
    将自定义格式的机器人数据转换为LeRobot格式
    
    Args:
        input_dir: 原始数据目录，包含images/和states/
        output_dir: 输出LeRobot格式数据目录
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    image_files = sorted(input_path.glob("images/*.png"))
    state_files = sorted(input_path.glob("states/*.npz"))
    
    dataset_info = {
        "meta": {
            "fps": fps,
            "camera_names": ["primary"],
            "robot_type": "generic",
        }
    }
    
    with open(output_path / "dataset_info.json", "w") as f:
        json.dump(dataset_info, f, indent=2)
    
    episodes = []
    for i, (img_file, state_file) in enumerate(zip(image_files[:-1], state_files[:-1])):
        current_state = np.load(state_file)
        next_state = np.load(state_files[i + 1])
        
        sample = {
            "observation.images.primary": str(img_file),
            "observation.state.joint": current_state["joint"].tolist(),
            "action.actors.main": current_state["action"].tolist(),
            "next_observation.images.primary": str(image_files[i + 1]),
            "next_observation.state.joint": next_state["joint"].tolist(),
        }
        
        episodes.append(sample)
    
    # 保存为LeRobot兼容的Parquet格式
    import pandas as pd
    df = pd.DataFrame(episodes)
    df.to_parquet(output_path / "data.parquet")
    
    print(f"转换完成: {len(episodes)} 个样本 → {output_path}")

# 使用示例
convert_to_lerobot_format(
    input_dir="./my_robot_data",
    output_dir="./lerobot_format_data",
    fps=30
)
```

### 3.3 使用YAM数据集（官方演示数据集）

NVIDIA提供了YAM机器人数据集用于Cosmos 3演示，可直接下载：

```bash
# 克隆YAM数据集
git clone https://huggingface.co/datasets/nvidia/YAM-robot-dataset
cd YAM-robot-dataset

# 转换为LeRobot格式
python scripts/convert_to_lerobot.py --input ./raw --output ../lerobot_format_data
```

## 四、后训练配置

### 4.1 动作联合SFT配置文件

Cosmos 3提供三种后训练模式：**前向动力学（Forward Dynamics）**、**逆动力学（Inverse Dynamics）**、**策略模式（Policy Mode）**。本文聚焦前向动力学。

创建配置文件 `configs/action_joint_sft_nano_yam.py`：

```python
# Cosmos 3 Action Joint SFT配置（前向动力学模式）
from dataclasses import dataclass, field

@dataclass
class ActionJointSFTConfig:
    # 模型配置
    model_name: str = "Cosmos-3-Diffusion-4B"
    model_path: str = "./checkpoints/cosmos3-diffusion-4B"
    
    # VAE配置
    vae_path: str = "./checkpoints/cosmos3-nano"
    
    # 数据配置
    dataset_path: str = "./lerobot_format_data/data.parquet"
    image_key: str = "observation.images.primary"
    state_key: str = "observation.state.joint"
    action_key: str = "action.actors.main"
    
    # 训练配置
    num_gpus: int = 4
    num_nodes: int = 1
    batch_size_per_gpu: int = 1
    gradient_accumulation_steps: int = 16
    learning_rate: float = 1e-5
    num_train_steps: int = 10000
    warmup_steps: int = 500
    weight_decay: float = 0.01
    
    # 动作条件化配置（关键！）
    action_conditioning: bool = True
    action_head_type: str = "joint"  # 关节模式，同时输出所有关节
    num_action_tokens: int = 8  # 动作序列被编码为8个token
    
    # 日志与保存
    log_interval: int = 10
    save_interval: int = 1000
    output_dir: str = "./outputs/cosmos3-forward-dynamics"

config = ActionJointSFTConfig()
```

### 4.2 理解关键参数

- **`action_conditioning: True`**：启用动作条件化，这是前向动力学模型的核心
- **`action_head_type: "joint"`**：同时输出所有关节的动作预测（相对"decoupled"模式）
- **`num_action_tokens: 8`**：动作序列被tokenizer压缩为8个token，影响动作信息的编码精度

## 五、开始训练

### 5.1 启动分布式训练

```bash
torchrun --nnodes=1 --nproc_per_node=4 \
    cosmos3/train/action_joint_sft.py \
    --config ./configs/action_joint_sft_nano_yam.py \
    --output_dir ./outputs/cosmos3-forward-dynamics \
    2>&1 | tee logs/training.log
```

关键参数：
- `--nnodes`: 节点数（单机为1）
- `--nproc_per_node`: 每节点GPU数（本文用4卡）

### 5.2 训练输出解读

正常启动后会看到如下日志：

```
[Epoch 0/312] Step 10/10000 | Loss: 0.4521 | LR: 1.2e-07
[Epoch 0/312] Step 20/10000 | Loss: 0.3845 | LR: 2.4e-07
[Epoch 0/312] Step 30/10000 | Loss: 0.3567 | LR: 3.6e-07
...
[INFO] Saving checkpoint at step 1000 to ./outputs/cosmos3-forward-dynamics/checkpoint-step1000
[INFO] EMA weights exported to ./outputs/cosmos3-forward-dynamics/checkpoint-step1000/ema_model.pt
```

损失函数稳定下降说明训练正常。若Loss出现NaN，检查输入数据的归一化是否正确。

### 5.3 使用EMA权重

Cosmos 3官方推荐使用**指数移动平均（EMA）**权重进行推理，而非直接使用最终checkpoint：

```bash
python cosmos3/export/export_ema.py \
    --checkpoint ./outputs/cosmos3-forward-dynamics/checkpoint-step1000 \
    --output ./outputs/cosmos3-forward-dynamics/ema_step1000.pt
```

## 六、推理验证

### 6.1 运行前向预测推理

```bash
python cosmos3/inference/forward_dynamics_inference.py \
    --model ./outputs/cosmos3-forward-dynamics/ema_step1000.pt \
    --vae ./checkpoints/cosmos3-nano \
    --input_json ./inference_examples/bridge_example.json \
    --output_video ./predictions/output.mp4 \
    --num_frames 16
```

### 6.2 输入JSON格式

```json
{
  "conditioning_video": "./test_data/bridge_obs_frame_0.png",
  "conditioning_frame_count": 1,
  "actions": [
    [0.01, -0.02, 0.03, 0.01, -0.01, 0.02, 0.0],
    [0.02, -0.03, 0.04, 0.01, -0.02, 0.03, 0.0],
    [0.03, -0.04, 0.05, 0.02, -0.03, 0.04, 0.0]
  ],
  "task_description": "Pick up the red cube from the table",
  "num_output_frames": 16
}
```

### 6.3 评估预测质量

```python
import torch
import numpy as np
from cosmos3.eval.compute_metrics import compute_dynamics_metrics

def evaluate_predictions(pred_video, gt_video):
    """
    计算前向动力学模型的预测质量指标
    """
    metrics = compute_dynamics_metrics(pred_video, gt_video)
    
    print("=== Forward Dynamics Evaluation ===")
    print(f"FVD (Fréchet Video Distance): {metrics['fvd']:.4f}")
    print(f"PSNR: {metrics['psnr']:.2f} dB")
    print(f"SSIM: {metrics['ssim']:.4f}")
    print(f"Action Accuracy: {metrics['action_accuracy']:.2%}")
    
    return metrics

# 使用示例
pred_path = "./predictions/output.mp4"
gt_path = "./test_data/ground_truth.mp4"
results = evaluate_predictions(pred_path, gt_path)
```

## 七、实战建议与调优技巧

### 7.1 数据质量比数据量更重要

Cosmos 3的后训练不需要海量数据，但**每个样本的质量至关重要**。建议：
- 图像分辨率不低于224×224
- 关节角度需要精确校准，误差过大会导致模型学到错误映射
- 动作序列建议覆盖机器人所有工作空间，而非单一姿态

### 7.2 学习率调度

建议使用**余弦退火（Cosine Annealing）**学习率：

```python
from torch.optim.lr_scheduler import CosineAnnealingLR

scheduler = CosineAnnealingLR(
    optimizer,
    T_max=config.num_train_steps,
    eta_min=1e-7
)
```

### 7.3 多GPU扩展

硬件不足时，可通过调整数据并行度（Data Parallelism）适配：

```python
# 在config中调整
gradient_accumulation_steps: int = 32  # 增加累积步数，弥补batch size减小
```

## 八、下一步：从预测到控制

前向动力学模型只是**机器人策略学习的一半**。另一半是**逆动力学（Inverse Dynamics）**——给定当前状态和目标状态，反推需要执行的动作序列。

将前向模型与逆模型结合，可以使用**模型预测控制（Model Predictive Control, MPC）**框架：

```
目标状态 → 逆模型 → 候选动作序列 → 前向模型验证 → 选择最优动作 → 执行
```

Cosmos 3的三种后训练模式（Forward Dynamics / Inverse Dynamics / Policy）正是为这一完整pipeline设计的。掌握前向动力学之后，建议继续尝试逆动力学和策略模式，构建完整的"预测-规划-控制"闭环。

## 九、参考资料

- [Cosmos 3 Technical Blog](https://nvda.ws/4u5G0x8)
- [Cosmos 3 HuggingFace Collection](https://huggingface.co/collections/nvidia/cosmos3)
- [Cosmos 3 GitHub Repository](https://github.com/nvidia/Cosmos)
- [Cosmos 3 Post-Training Documentation](https://github.com/nvidia/Cosmos/blob/main/docs/training.md)
- [NVIDIA Cosmos DeveloperYouTube](https://www.youtube.com/watch?v=NdARy_BvJRY)

---

*本文基于Cosmos 3官方文档与NVIDIA 2026年发布的技术规范编写，实际使用请以官方最新版本为准。*