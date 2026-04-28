"""
Knowledge Service - 知识库服务模块

该模块负责管理知识库相关功能：
- 从本地设置中获取启用的知识库数据
- 提供统一的知识库访问接口

架构说明：
- 前端从云端API获取知识库数据
- 前端将启用的知识库完整数据存储到本地settings中
- Python本地服务从settings直接读取知识库数据，无需访问云端

主要功能：
1. 从设置中获取启用的知识库完整数据
2. 提供格式化的知识库信息访问接口
3. 与设置服务集成管理知识库数据
"""

from typing import List, Dict, Any
from .settings_service import settings_service


class KnowledgeService:
    """
    知识库服务类

    负责从本地设置中管理和访问知识库数据
    """

    def __init__(self):
        """初始化知识库服务"""
        pass

    def get_enabled_knowledge_ids(self) -> List[str]:
        """
        获取用户启用的知识库ID列表

        Returns:
            List[str]: 启用的知识库ID列表
        """
        return settings_service.get_enabled_knowledge_ids()

    def get_enabled_knowledge_data(self) -> List[Dict[str, Any]]:
        """
        获取用户启用的知识库完整数据列表

        Returns:
            List[Dict[str, Any]]: 知识库数据列表
        """
        return settings_service.get_enabled_knowledge_data()

    def list_user_enabled_knowledge(self) -> List[Dict[str, Any]]:
        """
        获取用户启用的知识库详细信息列表

        这是主要的对外接口，返回包含name、description、content等信息的知识库列表

        Returns:
            List[Dict[str, Any]]: 知识库信息列表，每个项目包含：
                - id: 知识库ID
                - name: 知识库名称
                - description: 知识库描述
                - content: 知识库内容
                - cover: 封面图片URL
                - is_public: 是否公开
                - created_at: 创建时间
                - updated_at: 更新时间
        """
        knowledge_list = self.get_enabled_knowledge_data()

        # 确保返回的数据包含必要字段
        formatted_list = []
        for kb in knowledge_list:
            formatted_kb = {
                'id': kb.get('id', ''),
                'name': kb.get('name', ''),
                'description': kb.get('description', ''),
                'content': kb.get('content', ''),
                'cover': kb.get('cover', ''),
                'is_public': kb.get('is_public', False),
                'created_at': kb.get('created_at', ''),
                'updated_at': kb.get('updated_at', ''),
            }
            formatted_list.append(formatted_kb)

        return formatted_list

    async def update_enabled_knowledge_data(self, knowledge_data_list: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        更新启用的知识库完整数据

        Args:
            knowledge_data_list (List[Dict[str, Any]]): 知识库数据列表

        Returns:
            Dict[str, Any]: 操作结果
        """
        return await settings_service.update_enabled_knowledge_data(knowledge_data_list)


# 创建全局知识库服务实例
knowledge_service = KnowledgeService()


# 提供便捷的全局函数
def list_user_enabled_knowledge() -> List[Dict[str, Any]]:
    """
    获取用户启用的知识库详细信息列表 (全局函数)

    这是一个便捷的全局函数，可以直接调用获取用户启用的知识库信息

    Returns:
        List[Dict[str, Any]]: 知识库信息列表
    """
    return knowledge_service.list_user_enabled_knowledge()
