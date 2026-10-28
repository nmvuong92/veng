class Veng < Formula
  desc "Luyện thì tiếng Anh trong terminal — dịch Việt → Anh, AI chấm"
  homepage "https://github.com/nmvuong92/veng"
  url "https://github.com/nmvuong92/veng/releases/download/v0.7.6/veng-0.7.6.tgz"
  sha256 "24a2e1a8ad8d9b1bfc46dafb5fb42bee9706711ba6455039893319fbc64ecffb"
  license "MIT"

  depends_on "node"

  def install
    libexec.install "veng.mjs"
    (bin/"veng").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/veng.mjs" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/veng --version")
  end
end
