"""
Settings Service - 设置服务模块

该模块负责管理应用程序的所有配置设置，包括：
- 代理配置（proxy settings）
- 系统提示词（system prompts）
- 其他应用配置项

主要功能：
1. 读取和写入 JSON 格式的设置文件
2. 提供默认设置配置
3. 敏感信息掩码处理（如密码）
4. 设置的合并和更新操作
5. 全局设置状态管理

文件结构：
- DEFAULT_SETTINGS: 默认配置模板
- SettingsService: 核心设置服务类
- settings_service: 全局服务实例
- app_settings: 全局设置缓存
"""

import os
import traceback
import json

# 用户数据目录路径，优先使用环境变量，否则使用默认路径
USER_DATA_DIR = os.getenv("USER_DATA_DIR", os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "user_data"))

# 全局设置配置缓存，用于在应用运行时快速访问设置
app_settings = {}

# 默认设置配置模板
# 定义了应用程序的基础配置结构和默认值
DEFAULT_SETTINGS = {
    "proxy": "system",  # 代理设置：'' (不使用代理), 'system' (使用系统代理), 或具体的代理URL地址
    "enabled_knowledge": [],  # 启用的知识库ID列表（保持兼容性）
    "enabled_knowledge_data": []  # 启用的知识库完整数据列表
}


class SettingsService:
    """
    设置服务类

    负责管理应用程序的所有配置设置，包括读取、写入、更新等操作。
    使用 TOML 格式存储配置文件，支持设置的合并和敏感信息掩码。

    Attributes:
        root_dir (str): 项目根目录路径
        settings_file (str): 设置文件的完整路径
    """

    def __init__(self):
        """
        初始化设置服务

        设置项目根目录和配置文件路径。
        配置文件路径可通过环境变量 SETTINGS_PATH 自定义。
        """
        self.root_dir = os.path.dirname(
            os.path.dirname(os.path.dirname(__file__)))
        self.settings_file = os.getenv(
            "SETTINGS_PATH", os.path.join(USER_DATA_DIR, "settings.json"))

    async def exists_settings(self):
        """
        检查设置文件是否存在

        Returns:
            bool: 如果设置文件存在返回 True，否则返回 False

        Note:
            这是一个异步方法，主要是为了保持 API 接口的一致性
        """
        return os.path.exists(self.settings_file)

    def get_settings(self):
        """
        获取所有设置配置（用于 API 响应）

        该方法会：
        1. 读取设置文件（如果不存在则创建默认配置）
        2. 与默认设置合并，确保所有必需的键都存在
        3. 对敏感信息进行掩码处理
        4. 更新全局设置缓存

        Returns:
            dict: 包含所有设置的字典，敏感信息已被掩码

        Note:
            返回的设置适用于 API 响应，敏感信息（如密码）会被 '*' 掩码
        """
        try:
            if not os.path.exists(self.settings_file):
                # 如果设置文件不存在，创建默认设置文件
                self.create_default_settings()

            # 读取 JSON 配置文件
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                settings = json.load(f)

            # 与默认设置合并，确保所有键都存在
            merged_settings = {**DEFAULT_SETTINGS}
            for key, value in settings.items():
                if key in merged_settings and isinstance(merged_settings[key], dict) and isinstance(value, dict):
                    # 对于字典类型的设置，进行深度合并
                    merged_settings[key].update(value)
                else:
                    # 其他类型直接覆盖
                    merged_settings[key] = value

            # 更新全局设置缓存（存储未掩码的完整版本）
            global app_settings
            app_settings = merged_settings
            return merged_settings
        except Exception as e:
            print(f"Error loading settings: {e}")
            traceback.print_exc()
            return DEFAULT_SETTINGS

    def get_raw_settings(self):
        """
        获取原始设置（内部使用，不掩码敏感信息）

        该方法返回完整的设置配置，包括敏感信息，主要用于：
        1. 系统内部逻辑使用
        2. 代理配置等需要完整信息的场景
        3. 设置的验证和处理

        Returns:
            dict: 包含所有设置的完整字典，敏感信息未被掩码

        Note:
            此方法返回的数据包含敏感信息，仅供内部使用，不应直接用于 API 响应
        """
        try:
            if not os.path.exists(self.settings_file):
                # 如果设置文件不存在，创建默认设置
                self.create_default_settings()

            # 读取 JSON 配置文件
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                settings = json.load(f)

            # 与默认设置合并
            merged_settings = {**DEFAULT_SETTINGS}
            for key, value in settings.items():
                if key in merged_settings and isinstance(merged_settings[key], dict) and isinstance(value, dict):
                    merged_settings[key].update(value)
                else:
                    merged_settings[key] = value

            # 更新全局设置缓存
            global app_settings
            app_settings = merged_settings
            return merged_settings
        except Exception as e:
            print(f"Error loading raw settings: {e}")
            return DEFAULT_SETTINGS

    def get_proxy_config(self):
        """
        获取代理配置

        Returns:
            str: 代理配置字符串
                - '' : 不使用代理
                - 'system' : 使用系统代理
                - URL地址 : 使用指定的代理服务器
        """
        settings = self.get_raw_settings()
        return settings.get('proxy', '')

    def get_enabled_knowledge_ids(self):
        """
        获取启用的知识库ID列表

        Returns:
            list: 启用的知识库ID列表
        """
        settings = self.get_raw_settings()
        return settings.get('enabled_knowledge', [])

    async def update_enabled_knowledge(self, knowledge_ids):
        """
        更新启用的知识库列表

        Args:
            knowledge_ids (list): 知识库ID列表

        Returns:
            dict: 操作结果
        """
        return await self.update_settings({"enabled_knowledge": knowledge_ids})

    def get_enabled_knowledge_data(self):
        """
        获取启用的知识库完整数据列表

        Returns:
            list: 知识库数据列表，每个项目包含name、description、content等信息
        """
        settings = self.get_raw_settings()
        return settings.get('enabled_knowledge_data', [])

    async def update_enabled_knowledge_data(self, knowledge_data_list):
        """
        更新启用的知识库完整数据

        Args:
            knowledge_data_list (list): 知识库数据列表，包含完整的知识库信息

        Returns:
            dict: 操作结果
        """
        # 同时更新ID列表和完整数据
        knowledge_ids = [kb.get('id', '')
                         for kb in knowledge_data_list if kb.get('id')]
        return await self.update_settings({
            "enabled_knowledge": knowledge_ids,
            "enabled_knowledge_data": knowledge_data_list
        })

    def create_default_settings(self):
        """
        创建默认设置文件

        当设置文件不存在时，根据 DEFAULT_SETTINGS 模板创建新的配置文件。
        会自动创建必要的目录结构。

        Raises:
            Exception: 当文件创建失败时抛出异常
        """
        try:
            # 确保目录存在
            os.makedirs(os.path.dirname(self.settings_file), exist_ok=True)

            # 写入默认设置到 JSON 文件
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(DEFAULT_SETTINGS, f, indent=2)
        except Exception as e:
            print(f"Error creating default settings: {e}")

    async def update_settings(self, data):
        """
        更新设置配置

        该方法会：
        1. 读取现有设置
        2. 与新数据进行合并（深度合并字典类型）
        3. 保存更新后的设置到文件
        4. 更新全局设置缓存

        Args:
            data (dict): 要更新的设置数据，可以是部分设置

        Returns:
            dict: 包含操作状态和消息的字典
                - status (str): "success" 或 "error"
                - message (str): 操作结果描述

        Example:
            result = await settings_service.update_settings({
                "proxy": {"enable": True, "url": "http://proxy.com:8080"}
            })
        """
        try:
            # 加载现有设置，如果文件不存在则使用默认设置
            existing_settings = DEFAULT_SETTINGS.copy()
            if os.path.exists(self.settings_file):
                try:
                    with open(self.settings_file, 'r', encoding='utf-8') as f:
                        existing_settings = json.load(f)
                except Exception as e:
                    print(f"Error reading existing settings: {e}")

            # 合并新数据到现有设置
            for key, value in data.items():
                if key in existing_settings and isinstance(existing_settings[key], dict) and isinstance(value, dict):
                    # 对于字典类型，进行深度合并而不是替换
                    existing_settings[key].update(value)
                else:
                    # 其他类型直接覆盖
                    existing_settings[key] = value

            # 确保目录存在
            os.makedirs(os.path.dirname(self.settings_file), exist_ok=True)

            # 保存更新后的设置到文件
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(existing_settings, f, indent=2)

            # 更新全局设置缓存
            global app_settings
            app_settings = existing_settings

            return {"status": "success", "message": "Settings updated successfully"}
        except Exception as e:
            traceback.print_exc()
            return {"status": "error", "message": str(e)}


# 创建全局设置服务实例
# 整个应用程序使用这个单例实例来管理设置
settings_service = SettingsService()

# 在模块导入时初始化设置
# 确保全局设置缓存在应用启动时就被加载
settings_service.get_raw_settings()
