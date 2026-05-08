namespace XiaoLou.ClosedApiWorker.Vertex;

internal sealed class VertexProviderException(string message, bool retry, Exception? innerException = null)
    : Exception(message, innerException)
{
    public bool Retry { get; } = retry;
}
