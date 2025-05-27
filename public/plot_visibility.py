import pandas as pd
import matplotlib.pyplot as plt
import sys
import os

def main(filename):
    # ファイル存在チェック
    if not os.path.isfile(filename):
        print(f"Error: File '{filename}' not found.")
        print("Usage: python plot_visibility.py [filename.csv]")
        sys.exit(1)

    # CSV読み込み
    df = pd.read_csv(filename)

    # 秒 → 時間
    df["Hour"] = df["Time"] / 3600

    # プロット
    fig, ax = plt.subplots(figsize=(10, 6))

    for column in df.columns[1:-1]:  # 地上局列のみ
        ax.plot(df["Hour"], df[column], label=column)

    ax.set_xlabel("Elapsed Time (hours)")
    ax.set_ylabel("Number of Visible Satellites")
    ax.set_title("Satellite Visibility per Ground Station")
    ax.set_ylim(bottom=0)
    ax.legend(loc="upper right")
    ax.grid(True)

    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    # 引数があればそれを使い、なければ 'report.csv'
    filename = sys.argv[1] if len(sys.argv) > 1 else "report.csv"
    main(filename)
